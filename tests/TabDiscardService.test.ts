import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tabDiscardService } from "../services/TabDiscardService"
import { tabGroupService } from "../services/TabGroupService"
import { tabGroupState } from "../services/TabGroupState"
import { mockBrowser } from "./setup"

describe("TabDiscardService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tabGroupService.endStartupGracePeriod()
    tabGroupState.protectedGroupTitles = []
    tabDiscardService.updateFromStorage({
      tabDiscardEnabled: true,
      tabDiscardInactivityMinutes: 1,
      tabDiscardExcludedDomains: [],
      tabDiscardProtectProtectedGroups: true,
      tabDiscardMinTabCount: 0,
      tabDiscardShowWakeNotice: true
    })
  })

  afterEach(() => {
    tabDiscardService.stop()
    vi.clearAllMocks()
  })

  it("should discard tabs inactive for the configured inactivity threshold", async () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 1,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twoMinutesAgo,
        url: "https://example.com"
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(1)
    expect(mockBrowser.tabs.discard).toHaveBeenCalledWith(1)
    expect(tabDiscardService.wasTabDiscarded(1)).toBe(true)
  })

  it("should NOT discard tabs when tabDiscardEnabled is false", async () => {
    tabDiscardService.updateFromStorage({ tabDiscardEnabled: false })
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 1,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twoMinutesAgo,
        url: "https://example.com"
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(0)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalled()
  })

  it("should NOT discard tabs when domain is in excludedDomains list", async () => {
    tabDiscardService.updateFromStorage({
      tabDiscardExcludedDomains: ["meet.google.com", "dashboard.internal.net"]
    })
    const twentyMinutesAgo = Date.now() - 20 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 10,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://meet.google.com/abc-defg-hij"
      },
      {
        id: 11,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://dashboard.internal.net/analytics"
      },
      {
        id: 12,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://other-site.com"
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(1)
    expect(mockBrowser.tabs.discard).toHaveBeenCalledWith(12)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalledWith(10)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalledWith(11)
  })

  it("should NOT discard tabs in protected groups when protectProtectedGroups is true", async () => {
    tabGroupState.protectedGroupTitles = ["Work Docs"]
    mockBrowser.tabGroups = {
      get: vi.fn().mockResolvedValue({ id: 99, title: "Work Docs" })
    } as any

    const twentyMinutesAgo = Date.now() - 20 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 20,
        groupId: 99,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://docs.google.com/document/d/123"
      },
      {
        id: 21,
        groupId: -1,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://random-blog.com"
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(1)
    expect(mockBrowser.tabs.discard).toHaveBeenCalledWith(21)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalledWith(20)
  })

  it("should NOT discard tabs if total tab count is below or equal to minTabCount", async () => {
    tabDiscardService.updateFromStorage({ tabDiscardMinTabCount: 5 })
    const twentyMinutesAgo = Date.now() - 20 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 1,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://site1.com"
      },
      {
        id: 2,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twentyMinutesAgo,
        url: "https://site2.com"
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(0)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalled()
  })

  it("should NOT discard tabs that are playing audio (audible = true)", async () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 2,
        active: false,
        discarded: false,
        pinned: false,
        audible: true, // Playing music/audio
        lastAccessed: twoMinutesAgo,
        url: "https://youtube.com/watch?v=123"
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(0)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalled()
  })

  it("should NOT discard active or pinned or already discarded tabs", async () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 3,
        active: true, // Active tab
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twoMinutesAgo
      },
      {
        id: 4,
        active: false,
        discarded: false,
        pinned: true, // Pinned tab
        audible: false,
        lastAccessed: twoMinutesAgo
      },
      {
        id: 5,
        active: false,
        discarded: true, // Already discarded
        pinned: false,
        audible: false,
        lastAccessed: twoMinutesAgo
      }
    ])

    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(0)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalled()
  })

  it("should NOT discard tabs when startup grace period is active", async () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    mockBrowser.tabs.query.mockResolvedValue([
      {
        id: 6,
        active: false,
        discarded: false,
        pinned: false,
        audible: false,
        lastAccessed: twoMinutesAgo,
        url: "https://example.com"
      }
    ])

    tabGroupService.startStartupGracePeriod(3000)
    const discarded = await tabDiscardService.checkAndDiscardInactiveTabs()
    expect(discarded).toBe(0)
    expect(mockBrowser.tabs.discard).not.toHaveBeenCalled()

    tabGroupService.endStartupGracePeriod()
  })

  it("should trigger wake notice when discarded tab is activated", async () => {
    tabDiscardService.markTabAsDiscarded(50)
    mockBrowser.tabs.get.mockResolvedValue({
      id: 50,
      url: "https://example.com/article"
    } as any)

    await tabDiscardService.handleTabActivated(50)

    expect(mockBrowser.tabs.sendMessage).toHaveBeenCalledWith(
      50,
      expect.objectContaining({
        action: "SHOW_WAKE_NOTICE"
      })
    )
  })
})
