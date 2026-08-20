// Webview side of the test process log view. Deliberately thin: everything worth testing lives
// on the extension side, in `src/testing/testProcessLogView.ts`, because this file is not
// compiled by `tsc` and so is not reachable from the test suite.
//
// `Terminal`, `FitAddon` and `SearchAddon` are UMD globals from `libs/xterm`.

;(function () {
    const vscodeAPI = acquireVsCodeApi()

    // Every colour xterm needs has a matching VS Code theme key, injected into the webview as a
    // CSS variable. Reading them here rather than passing them in from the extension means the
    // palette is whatever the active theme actually resolved to, including user overrides.
    function readTheme() {
        const style = getComputedStyle(document.body)
        const read = (name, fallback) => {
            const value = style.getPropertyValue(name).trim()
            return value.length > 0 ? value : fallback
        }

        // `terminal.background` is registered with no default, so it resolves to whatever view
        // the terminal sits in — the panel, for the Test Results output we are matching. It
        // therefore comes through empty unless a theme sets it explicitly, and falling straight
        // to the editor background is what made this panel lighter than Test Results.
        const background = read(
            '--vscode-terminal-background',
            read('--vscode-panel-background', read('--vscode-editor-background', '#1e1e1e'))
        )
        const foreground = read(
            '--vscode-terminal-foreground',
            read('--vscode-foreground', read('--vscode-editor-foreground', '#cccccc'))
        )

        const theme = {
            background: background,
            foreground: foreground,
            cursor: read('--vscode-terminalCursor-foreground', foreground),
            selectionBackground: read('--vscode-terminal-selectionBackground', undefined),
        }

        const names = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']
        for (const name of names) {
            const key = name.toLowerCase()
            const plain = read('--vscode-terminal-ansi' + name, undefined)
            const bright = read('--vscode-terminal-ansiBright' + name, undefined)
            if (plain) {
                theme[key] = plain
            }
            if (bright) {
                theme['bright' + name] = bright
            }
        }

        return theme
    }

    const term = new Terminal({
        // The process stream is raw pipe output with bare LFs; xterm otherwise treats those as
        // line feeds without a carriage return and staircases the whole log.
        convertEol: true,
        disableStdin: true,
        cursorStyle: 'underline',
        cursorBlink: false,
        scrollback: 100000,
        theme: readTheme(),
    })

    const isCopyChord = (e) => (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')
    const isSelectAllChord = (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')

    // xterm claims Ctrl+C to send an interrupt, and with `disableStdin` it then goes nowhere at
    // all. Handing these chords back means the document level listener below sees them.
    term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') {
            return true
        }
        return !(isCopyChord(e) || isSelectAllChord(e))
    })

    const fitAddon = new FitAddon.FitAddon()
    const searchAddon = new SearchAddon.SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)

    const container = document.getElementById('terminal')
    term.open(container)
    fitAddon.fit()

    new ResizeObserver(() => {
        try {
            fitAddon.fit()
        } catch {
            // `fit` throws while the webview is hidden and has no dimensions to measure.
        }
    }).observe(container)

    // xterm keeps the viewport where the user put it, so a log that is being tailed only
    // follows if we ask it to — and only when the user had not scrolled away to read something.
    function writeKeepingScroll(text) {
        const buffer = term.buffer.active
        const wasAtBottom = buffer.viewportY >= buffer.baseY
        term.write(text, () => {
            if (wasAtBottom) {
                term.scrollToBottom()
            }
        })
    }

    const findBar = document.getElementById('find')
    const findInput = document.getElementById('find-input')

    function showFind() {
        findBar.classList.add('visible')
        findInput.select()
        findInput.focus()
    }

    function hideFind() {
        findBar.classList.remove('visible')
        searchAddon.clearDecorations()
        term.focus()
    }

    // The extension host owns the clipboard here rather than `navigator.clipboard`: a webview
    // has focus and permission constraints the extension side simply does not have. And the
    // selection has to come from `term.getSelection()`, because xterm draws it as an overlay
    // rather than as a real DOM selection, so a native copy would find nothing to copy.
    function copySelection() {
        vscodeAPI.postMessage({ type: 'copy', text: term.getSelection() })
    }

    document.addEventListener('keydown', (e) => {
        // The find box is an ordinary input, so leave its own editing shortcuts alone.
        if (e.target === findInput && e.key !== 'Escape') {
            return
        }

        if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            showFind()
        } else if (e.key === 'Escape' && findBar.classList.contains('visible')) {
            e.preventDefault()
            hideFind()
        } else if (isCopyChord(e) && term.hasSelection()) {
            // With nothing selected there is nothing to copy, so the key is left alone rather
            // than swallowed.
            e.preventDefault()
            copySelection()
        } else if (isSelectAllChord(e)) {
            e.preventDefault()
            term.selectAll()
        }
    })

    findInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') {
            return
        }
        e.preventDefault()
        const query = findInput.value
        if (query.length === 0) {
            return
        }
        if (e.shiftKey) {
            searchAddon.findPrevious(query)
        } else {
            searchAddon.findNext(query)
        }
    })

    window.addEventListener('message', (event) => {
        const message = event.data

        switch (message.type) {
            case 'reset':
                term.reset()
                writeKeepingScroll(message.text)
                break
            case 'append':
                writeKeepingScroll(message.text)
                break
            case 'theme':
                term.options.theme = readTheme()
                break
            case 'font':
                if (message.fontFamily) {
                    term.options.fontFamily = message.fontFamily
                }
                if (message.fontSize) {
                    term.options.fontSize = message.fontSize
                }
                fitAddon.fit()
                break
            default:
                console.error('Unknown message type from extension: ' + message.type)
        }
    })

    vscodeAPI.postMessage({ type: 'ready' })
})()
