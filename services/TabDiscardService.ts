/**
 * Tab Discard Service (Soft Freeze & In-Page Sleep Mode)
 * Puts inactive background tabs into a gentle sleep state with zero automatic browser reloads:
 * 1. Pauses background media and heavy scripts.
 * 2. Displays an in-page floating sleep badge offering manual refresh or dismiss.
 * 3. Keeps Chrome native discard disabled (autoDiscardable: false) so Chrome never kills/reloads the page.
 */

import type { Browser } from "wxt/browser"
import type { StorageSchema } from "../types"
import { extractDomain } from "../utils/DomainUtils"
import { t } from "../utils/i18n"
import { tabGroupService } from "./TabGroupService"
import { tabGroupState } from "./TabGroupState"

export class TabDiscardService {
  private checkIntervalId: ReturnType<typeof setInterval> | null = null
  private lastActiveMap = new Map<number, number>()
  private frozenTabIds = new Set<number>()
  private readonly CHECK_INTERVAL_MS = 10 * 1000 // Check every 10 seconds

  private enabled = true
  private inactivityMinutes = 1
  private excludedDomains: string[] = []
  private protectProtectedGroups = true
  private minTabCount = 0
  private showWakeNotice = true

  /**
   * Initializes the tab discard monitor immediately and checks periodically
   */
  initialize(initialDelayMs = 2000): void {
    if (this.checkIntervalId) return

    setTimeout(() => {
      if (this.checkIntervalId) return
      this.checkAndDiscardInactiveTabs().catch(() => {})
      this.checkIntervalId = setInterval(() => {
        this.checkAndDiscardInactiveTabs().catch(err => {
          console.error("[TabDiscardService] Error checking inactive tabs:", err)
        })
      }, this.CHECK_INTERVAL_MS)
      console.log(`[TabDiscardService] Soft-freeze interval started (${this.inactivityMinutes}m threshold)`)
    }, initialDelayMs)

    console.log(`[TabDiscardService] Auto-discard initialized (first check in ${initialDelayMs / 1000}s)`)
  }

  /**
   * Stops the background monitor
   */
  stop(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId)
      this.checkIntervalId = null
    }
  }

  /**
   * Updates settings from storage and applies Chrome autoDiscardable policy
   */
  updateFromStorage(data: Partial<StorageSchema>): void {
    if (data.tabDiscardEnabled !== undefined) {
      this.enabled = data.tabDiscardEnabled
    }
    if (data.tabDiscardInactivityMinutes !== undefined) {
      this.inactivityMinutes = data.tabDiscardInactivityMinutes
    }
    if (data.tabDiscardExcludedDomains !== undefined) {
      this.excludedDomains = [...data.tabDiscardExcludedDomains]
    }
    if (data.tabDiscardProtectProtectedGroups !== undefined) {
      this.protectProtectedGroups = data.tabDiscardProtectProtectedGroups
    }
    if (data.tabDiscardMinTabCount !== undefined) {
      this.minTabCount = data.tabDiscardMinTabCount
    }
    if (data.tabDiscardShowWakeNotice !== undefined) {
      this.showWakeNotice = data.tabDiscardShowWakeNotice
    }

    // Ensure all tabs are protected against Chrome's hard-discarding
    this.disableBrowserHardDiscard().catch(() => {})
  }

  /**
   * Disables Chrome's native uncoordinated auto-discarding on all tabs
   * to guarantee zero automatic reloads.
   */
  async disableBrowserHardDiscard(targetTabId?: number): Promise<void> {
    try {
      const tabs = targetTabId
        ? [await browser.tabs.get(targetTabId).catch(() => null)].filter(
            (t): t is Browser.tabs.Tab => t !== null && t !== undefined
          )
        : await browser.tabs.query({})

      for (const tab of tabs) {
        if (!tab || !tab.id) continue
        if (tab.autoDiscardable !== false) {
          try {
            await browser.tabs.update(tab.id, { autoDiscardable: false })
          } catch {
            // Ignore
          }
        }
      }
    } catch (err) {
      console.debug("[TabDiscardService] Error disabling browser hard discard:", err)
    }
  }

  /**
   * Records when a tab becomes active or is accessed
   */
  recordTabActivity(tabId: number): void {
    this.lastActiveMap.set(tabId, Date.now())
  }

  /**
   * Removes tab from tracking on removal
   */
  removeTab(tabId: number): void {
    this.lastActiveMap.delete(tabId)
    this.frozenTabIds.delete(tabId)
  }

  /**
   * Marks a tab as frozen
   */
  markTabAsFrozen(tabId: number): void {
    this.frozenTabIds.add(tabId)
  }

  /**
   * Alias for markTabAsFrozen for backward compatibility
   */
  markTabAsDiscarded(tabId: number): void {
    this.markTabAsFrozen(tabId)
  }

  /**
   * Checks whether a tab was recorded as frozen
   */
  wasTabFrozen(tabId: number): boolean {
    return this.frozenTabIds.has(tabId)
  }

  /**
   * Alias for wasTabFrozen for backward compatibility
   */
  wasTabDiscarded(tabId: number): boolean {
    return this.wasTabFrozen(tabId)
  }

  /**
   * Checks whether a domain is excluded from auto-discard
   */
  isDomainExcluded(url: string | undefined): boolean {
    if (!url || !this.excludedDomains || this.excludedDomains.length === 0) {
      return false
    }

    const domain = extractDomain(url, false)
    const fullDomain = extractDomain(url, true)
    if (!domain && !fullDomain) return false

    const cleanExcluded = this.excludedDomains.map(d => d.trim().toLowerCase()).filter(Boolean)
    const lowerDomain = (domain || "").toLowerCase()
    const lowerFullDomain = (fullDomain || "").toLowerCase()

    return cleanExcluded.some(excluded => {
      const cleanPattern = excluded.replace(/^https?:\/\//, "").split("/")[0].toLowerCase()
      if (!cleanPattern) return false
      return (
        lowerDomain === cleanPattern ||
        lowerFullDomain === cleanPattern ||
        lowerFullDomain.endsWith("." + cleanPattern)
      )
    })
  }

  /**
   * Checks whether a tab is inside a protected tab group
   */
  async isInProtectedGroup(tab: Browser.tabs.Tab): Promise<boolean> {
    if (!this.protectProtectedGroups) return false
    if (!tab.groupId || tab.groupId === -1) return false
    if (!browser.tabGroups) return false
    if (tabGroupState.protectedGroupTitles.length === 0) return false

    try {
      const group = await browser.tabGroups.get(tab.groupId)
      return tabGroupService.isProtectedTitle(group?.title)
    } catch {
      return false
    }
  }

  /**
   * Handles tab activation: records activity and clears frozen badge tracking
   */
  async handleTabActivated(tabId: number): Promise<void> {
    this.recordTabActivity(tabId)
    this.frozenTabIds.delete(tabId)
  }

  /**
   * Checks all open tabs and soft-freezes eligible inactive background tabs
   */
  async checkAndDiscardInactiveTabs(): Promise<number> {
    if (!this.enabled) return 0
    if (tabGroupService.isStartupGracePeriodActive()) {
      return 0
    }

    try {
      const tabs = await browser.tabs.query({})
      if (this.minTabCount > 0 && tabs.length <= this.minTabCount) {
        return 0
      }

      const now = Date.now()
      const thresholdMs = Math.max(1, this.inactivityMinutes) * 60 * 1000
      let frozenCount = 0

      for (const tab of tabs) {
        if (!tab.id) continue

        // Do not freeze active tabs
        if (tab.active) {
          this.lastActiveMap.set(tab.id, now)
          continue
        }

        // Do not freeze pinned tabs
        if (tab.pinned) continue

        // Do not freeze tabs actively playing audio
        if (tab.audible) {
          this.lastActiveMap.set(tab.id, now)
          continue
        }

        // Do not freeze internal extension or browser pages
        if (
          tab.url?.startsWith("chrome-extension://") ||
          tab.url?.startsWith("moz-extension://") ||
          tab.url?.startsWith("chrome://") ||
          tab.url?.startsWith("edge://") ||
          tab.url?.startsWith("about:")
        ) {
          continue
        }

        // Check excluded domains
        if (this.isDomainExcluded(tab.url)) {
          continue
        }

        // Check protected groups
        if (await this.isInProtectedGroup(tab)) {
          continue
        }

        // Determine last accessed time
        const tabLastAccessed = this.lastActiveMap.get(tab.id) ?? tab.lastAccessed ?? (now - thresholdMs)
        if (now - tabLastAccessed >= thresholdMs) {
          try {
            // Send In-Page Soft Freeze message to pause media and show sleep badge
            await browser.tabs.sendMessage(tab.id, {
              action: "FREEZE_TAB",
              noticeText: t(
                "tabDiscardWakeNoticeText",
                "تم تجميد هذه الصفحة في وضع السكون لتوفير الذاكرة. انقر للتحديث أو تابع التصفح."
              ),
              reloadBtnText: t("tabDiscardReloadBtn", "إعادة تحميل"),
              dismissBtnText: t("tabDiscardDismissBtn", "متابعة التصفح")
            })
            this.frozenTabIds.add(tab.id)
            frozenCount++
            console.log(`[TabDiscardService] In-page soft freeze applied to tab ${tab.id} ("${tab.title || tab.url}")`)
          } catch (freezeErr) {
            console.debug(`[TabDiscardService] Content script message skipped for tab ${tab.id}:`, freezeErr)
          }
        }
      }

      return frozenCount
    } catch (error) {
      console.error("[TabDiscardService] Error during tab freeze scan:", error)
      return 0
    }
  }
}

export const tabDiscardService = new TabDiscardService()
