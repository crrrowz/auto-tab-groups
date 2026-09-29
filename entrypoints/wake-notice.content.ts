/**
 * In-Page Soft Freeze & Sleep State Overlay Content Script
 * 1. Pauses all background media and animations when sleeping.
 * 2. Renders a sleek floating glassmorphic sleep banner via isolated Shadow DOM.
 * 3. ZERO automatic page reloads: The DOM, state, and scroll position are 100% preserved.
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    let hostElement: HTMLDivElement | null = null
    let isFrozen = false

    function freezePage() {
      if (isFrozen) return
      isFrozen = true

      try {
        // Pause active media to free CPU & audio pipelines
        const mediaElements = document.querySelectorAll("video, audio")
        mediaElements.forEach(el => {
          try {
            const media = el as HTMLMediaElement
            if (!media.paused) {
              media.pause()
            }
          } catch {
            // Ignore
          }
        })
      } catch {
        // Ignore
      }
    }

    function removeSleepBanner() {
      if (hostElement) {
        try {
          hostElement.remove()
        } catch {
          // Ignore
        }
        hostElement = null
      }
    }

    function showSleepBanner(options: {
      noticeText?: string
      reloadBtnText?: string
      dismissBtnText?: string
    }) {
      removeSleepBanner()

      const host = document.createElement("div")
      host.id = "atg-sleep-mode-host"
      host.style.position = "fixed"
      host.style.top = "0"
      host.style.left = "0"
      host.style.width = "100%"
      host.style.zIndex = "2147483647"
      host.style.pointerEvents = "none"

      const shadow = host.attachShadow({ mode: "open" })

      const isRtl =
        document.documentElement.dir === "rtl" ||
        document.body?.dir === "rtl" ||
        /[\u0600-\u06FF]/.test(options.noticeText || "")

      const style = document.createElement("style")
      style.textContent = `
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          box-sizing: border-box;
        }
        *, *::before, *::after {
          box-sizing: inherit;
        }
        .banner-wrapper {
          display: flex;
          justify-content: center;
          padding-top: 14px;
          pointer-events: none;
        }
        .banner {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          background: rgba(18, 18, 24, 0.94);
          color: #f4f4f5;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 9999px;
          padding: 8px 18px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.3);
          pointer-events: auto;
          transform: translateY(-40px);
          opacity: 0;
          transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
          direction: ${isRtl ? "rtl" : "ltr"};
          max-width: min(92vw, 680px);
        }
        .banner.visible {
          transform: translateY(0);
          opacity: 1;
        }
        .banner.hiding {
          transform: translateY(-30px);
          opacity: 0;
        }
        .icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          color: #06b6d4;
          flex-shrink: 0;
        }
        .text {
          font-size: 12.5px;
          font-weight: 500;
          color: #e4e4e7;
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .btn-reload {
          background: #06b6d4;
          color: #0f172a;
          border: none;
          padding: 5px 14px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: background 0.15s ease, transform 0.1s ease;
          white-space: nowrap;
        }
        .btn-reload:hover {
          background: #22d3ee;
          transform: scale(1.02);
        }
        .btn-reload:active {
          transform: scale(0.98);
        }
        .btn-dismiss {
          background: transparent;
          color: #a1a1aa;
          border: none;
          padding: 4px;
          border-radius: 9999px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          transition: color 0.15s ease, background 0.15s ease;
        }
        .btn-dismiss:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }
      `

      const wrapper = document.createElement("div")
      wrapper.className = "banner-wrapper"

      const banner = document.createElement("div")
      banner.className = "banner"

      const iconDiv = document.createElement("div")
      iconDiv.className = "icon"
      iconDiv.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `

      const textSpan = document.createElement("span")
      textSpan.className = "text"
      textSpan.textContent =
        options.noticeText ||
        "تم تجميد هذه الصفحة في وضع السكون لتوفير الذاكرة. انقر للتحديث أو تابع التصفح."

      const actionsDiv = document.createElement("div")
      actionsDiv.className = "actions"

      const reloadBtn = document.createElement("button")
      reloadBtn.className = "btn-reload"
      reloadBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        <span>${options.reloadBtnText || "إعادة تحميل"}</span>
      `
      reloadBtn.addEventListener("click", () => {
        dismiss()
        window.location.reload()
      })

      const dismissBtn = document.createElement("button")
      dismissBtn.className = "btn-dismiss"
      dismissBtn.setAttribute("aria-label", options.dismissBtnText || "متابعة التصفح")
      dismissBtn.title = options.dismissBtnText || "متابعة التصفح"
      dismissBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `
      dismissBtn.addEventListener("click", () => {
        dismiss()
      })

      function dismiss() {
        banner.classList.remove("visible")
        banner.classList.add("hiding")
        setTimeout(() => {
          removeSleepBanner()
        }, 300)
      }

      actionsDiv.appendChild(reloadBtn)
      actionsDiv.appendChild(dismissBtn)

      banner.appendChild(iconDiv)
      banner.appendChild(textSpan)
      banner.appendChild(actionsDiv)

      wrapper.appendChild(banner)
      shadow.appendChild(style)
      shadow.appendChild(wrapper)

      document.documentElement.appendChild(host)
      hostElement = host

      requestAnimationFrame(() => {
        banner.classList.add("visible")
      })
    }

    browser.runtime.onMessage.addListener(message => {
      if (!message) return
      if (message.action === "FREEZE_TAB") {
        freezePage()
        showSleepBanner(message)
      } else if (message.action === "SHOW_WAKE_NOTICE") {
        showSleepBanner(message)
      }
    })
  }
})
