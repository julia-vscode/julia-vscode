# Change Log

All notable changes to the Julia extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
### Added
* Inline results now support markdown-`show` methods ([#2933](https://github.com/julia-vscode/julia-vscode/pull/2933))
* The Julia REPL works with VS Code's [shell integration](https://code.visualstudio.com/docs/editor/integrated-terminal#_shell-integration) feature ([#2941](https://github.com/julia-vscode/julia-vscode/pull/2941))
* It's now possible to add a special `ALL_MODULES_EXCEPT_MAIN` token to the list of compiled modules when debugging ([#61](https://github.com/julia-vscode/DebugAdapter.jl/pull/61))
* The REPL now also uses the `err` global variable to contain the most recent exception.
* Added support for the custom `application/vnd.julia-vscode.inlayHints` MIME type to display custom inlay hints (e.g. types inline with source code) in the editor ([#3328](https://github.com/julia-vscode/julia-vscode/pull/3328))

### Changed
* The language server now uses incremental sync ([#1105](https://github.com/julia-vscode/LanguageServer.jl/pull/1105))

### Fixed
* `Assigned but not used` linter annotations are now slightly more correct ([#339](https://github.com/julia-vscode/StaticLint.jl/pull/339))
* Actually fixed that issue with copying `Expr`s while debugging ([#60](https://github.com/julia-vscode/DebugAdapter.jl/pull/60))
* Fixed `when` clauses of some keybindings that caused incorrect matches when `editorLangId != julia` ([#2971](https://github.com/julia-vscode/julia-vscode/pull/2971))

## [1.6.25] - 2022-06-17
### Changed
* Inline results and inline profile traces are now themeable ([#2897](https://github.com/julia-vscode/julia-vscode/pull/2897))
* Inline evaluation now works in plain markdown files ([#2920](https://github.com/julia-vscode/julia-vscode/pull/2920))

### Fixed
* Restored a check (and notification) as to whether the Julia path is valid ([#2923](https://github.com/julia-vscode/julia-vscode/pull/2923))
* Erroneous `.JuliaFormatter.toml`s no longer cause the language server to crash ([#1101](https://github.com/julia-vscode/LanguageServer.jl/pull/1101))

## [1.6.23] - 2022-05-24
### Added
* Integrated the new allocation profiler ([#2890](https://github.com/julia-vscode/julia-vscode/pull/2890))
* The linter now warns when indexing into arrys with `for i in 1:length(A)` ([#338](https://github.com/julia-vscode/StaticLint.jl/pull/338))
* Added a code action for adding a SPDX header to files ([#1075](https://github.com/julia-vscode/LanguageServer.jl/pull/1075))
* Added a code action for organizing `using`/`import` statements ([#1076](https://github.com/julia-vscode/LanguageServer.jl/pull/1076))
* Added a code action for converting string to raw strings and back ([#1082](https://github.com/julia-vscode/LanguageServer.jl/pull/1082))
* Added a code action for adding a docstring template for function definitions ([#1084](https://github.com/julia-vscode/LanguageServer.jl/pull/1084))

### Changed
* Switched to LSP 3.17 ([#2886](https://github.com/julia-vscode/julia-vscode/pull/2886))

### Fixed
* Made the workspace even more robust. For real this time. ([#2892](https://github.com/julia-vscode/julia-vscode/pull/2892))
* Various parser fixes ([#338](https://github.com/julia-vscode/CSTParser.jl/pull/338))
* Fixed an issue with multiple "missing reference" actions being applied at the same time ([#1089](https://github.com/julia-vscode/LanguageServer.jl/pull/1089))

## [1.6.22] - 2022-05-04
### Added
* Modules can now be hidden in the workspace ([#2887](https://github.com/julia-vscode/julia-vscode/pull/2887))

## [1.6.18] - 2022-05-04
### Added
* The profile pane now has a button to save the current profile to a file ([#2847](https://github.com/julia-vscode/julia-vscode/pull/2847))
* Added a `Julia: New Julia File` command ([#1509](https://github.com/julia-vscode/julia-vscode/pull/1509), [#2877](https://github.com/julia-vscode/julia-vscode/pull/2877))
* Cell evaluation now shows inline results for all top-level code blocks when the `julia.execution.inlineResultsForCellEvaluation` setting is enabled ([#2866](https://github.com/julia-vscode/julia-vscode/pull/2866))
* Added a code action to replace `==`/`!=` with `===`/`!==` for comarisons with `nothing` ([#1048](https://github.com/julia-vscode/LanguageServer.jl/pull/1048))
* Added completions for string macros ([#1046](https://github.com/julia-vscode/LanguageServer.jl/pull/1046))
* Added a code action for replacing unused assignments/arguments with an underscore ([#1065](https://github.com/julia-vscode/LanguageServer.jl/pull/1065), [#1072](https://github.com/julia-vscode/LanguageServer.jl/pull/1072))

### Changed
* The Julia version is now appended to the REPL title ([#2857](https://github.com/julia-vscode/julia-vscode/pull/2857))
* The extension is now only auto-activated when a `Project.toml` is in the workspace, not any arbitrary `.jl` file ([#2850](https://github.com/julia-vscode/julia-vscode/pull/2850))
* Plot navigator screenshots were removed due to performance issues ([#2869](https://github.com/julia-vscode/julia-vscode/pull/2869))
* Improved documentation search scoring algorithm ([#1057](https://github.com/julia-vscode/LanguageServer.jl/pull/1057))
* Some code actions are now marked as `preferred`, which makes applying them easier ([#1063](https://github.com/julia-vscode/LanguageServer.jl/pull/1063))
* Code action `kind`s are now set appropriately when applicable ([#1062](https://github.com/julia-vscode/LanguageServer.jl/pull/1062))
* Improved auto completion presentation ([#1052](https://github.com/julia-vscode/LanguageServer.jl/pull/1052))
* Snippet completions now have their `kind` set to `snippet`, as is appropriate ([#1067](https://github.com/julia-vscode/LanguageServer.jl/pull/1067))

### Fixed
* Internal modules are now correctly loaded on all processes ([#2845](https://github.com/julia-vscode/julia-vscode/pull/2845))
* Big tables originating from notebooks are now correctly displayed ([#2848](https://github.com/julia-vscode/julia-vscode/pull/2848))
* Nested progress bars are more robust in the presence of multiple tasks ([#2845](https://github.com/julia-vscode/julia-vscode/pull/2854))
* The Language Server is now properly restatable again ([#2859](https://github.com/julia-vscode/julia-vscode/pull/2859))
* Notebook internals are now hidden in stacktraces ([#2862](https://github.com/julia-vscode/julia-vscode/pull/2862))
* Terminal link handler now properly works for Base-internal code ([#2865](https://github.com/julia-vscode/julia-vscode/pull/2865))
* `ans` assignment is now more robust, which fixes an issue when IJulia.jl is loaded ([#2867](https://github.com/julia-vscode/julia-vscode/pull/2867))
* Lines are now broken properly in the documentation browser ([#2870](https://github.com/julia-vscode/julia-vscode/pull/2870))
* `args` can now be specified in the Julia launch configuration ([#2872](https://github.com/julia-vscode/julia-vscode/pull/2872))
* `const` fields in mutable structs are now parsed correctly ([#336](https://github.com/julia-vscode/StaticLint.jl/pull/336))
* Fixed a race condition when downloading symbol server cache files ([#251](https://github.com/julia-vscode/SymbolServer.jl/pull/251))
* Package resolution now works properly for 1.7-style Manifests ([#252](https://github.com/julia-vscode/SymbolServer.jl/pull/252))
* Placeholder paths replacement in symbol server cache files now works more robustly ([#253](https://github.com/julia-vscode/SymbolServer.jl/pull/253))
* Fixed an issue with deepcopying `Expr`s in the debugger ([#58](https://github.com/julia-vscode/DebugAdapter.jl/pull/58))
* Code actions triggers are no longer off by one character ([#1050](https://github.com/julia-vscode/LanguageServer.jl/pull/1050))

## [1.6.17] - 2022-04-06
### Fixed
* Slightly better check for displaying objects in the workspace ([#2833](https://github.com/julia-vscode/julia-vscode/pull/2833))

## [1.6.16] - 2022-04-06
### Fixed
* Fix a problem when trying to display `missing`s in the workspace ([#2831](https://github.com/julia-vscode/julia-vscode/pull/2831))
* The `x == nothing` linter pass now also detects `nothing`s on the LHD ([#334](https://github.com/julia-vscode/StaticLint.jl/pull/334))

## [1.6.15] - 2022-04-03
### Fixed
* Notebooks now start properly in empty VS Code workspaces ([#2828](https://github.com/julia-vscode/julia-vscode/pull/2828))

## [1.6.14] - 2022-04-01
### Added
* More notebook startup diagnostics.

## [1.6.13] - 2022-04-01
### Added
* "Go to defintion" button for some workspace items ([#2815](https://github.com/julia-vscode/julia-vscode/pull/2815))

### Fixed
* `@edit` is now much more robust ([#2823](https://github.com/julia-vscode/julia-vscode/pull/2823))
* Fixed a formatting crash ([#1045](https://github.com/julia-vscode/LanguageServer.jl/pull/1045))

## [1.6.11] - 2022-03-28
### Fixed
* Fixed another bug in notebook error handling ([#2803](https://github.com/julia-vscode/julia-vscode/pull/2803))
* Persistent REPL is no more killed on window reload ([#2807](https://github.com/julia-vscode/julia-vscode/pull/2807))
* `LOAD_PATH` is now correctly set in notebooks ([#2810](https://github.com/julia-vscode/julia-vscode/pull/2810))
* Trying to display an empty profile trace now shows a warning instead of emitting a scary looking error ([#2809](https://github.com/julia-vscode/julia-vscode/pull/2809))
* Latex completions are now more robust ([#1042](https://github.com/julia-vscode/LanguageServer.jl/pull/1042))

## [1.6.8] - 2022-03-23
### Fixed
* Toolbar icon now works properly in Chromium based browsers ([#2794](https://github.com/julia-vscode/julia-vscode/pull/2794))
* juliaup integration is now more robust ([#2796](https://github.com/julia-vscode/julia-vscode/pull/2796))
* Inline diagnostics are now also displayed in the REPL ([#2797](https://github.com/julia-vscode/julia-vscode/pull/2797))
* Fix for dev'ed package with relative paths ([#2798](https://github.com/julia-vscode/julia-vscode/pull/2798))
* The language server now handles `exit` notifications correctly ([#1039](https://github.com/julia-vscode/LanguageServer.jl/pull/1039))

## [1.6.5] - 2022-03-20
### Fixed
* Inline error are now handled better during debugging ([#56](https://github.com/julia-vscode/DebugAdapter.jl/pull/56))
* Fixed an issue with generator linting ([#1037](https://github.com/julia-vscode/LanguageServer.jl/pull/1037))
* Fixed an issue with autocompletions containing multi-byte characters ([#1035](https://github.com/julia-vscode/LanguageServer.jl/pull/1035))
* Fixed a LSP spec violation ([#1038](https://github.com/julia-vscode/LanguageServer.jl/pull/1038))

## [1.6.4] - 2022-03-17
### Changed
* The default formatting style now does not surround kwargs `=` with whitespace ([#1033](https://github.com/julia-vscode/LanguageServer.jl/pull/1033))

### Fixed
* Errors in notebooks are now handled more robustly ([#2781](https://github.com/julia-vscode/julia-vscode/pull/2781), [#2783](https://github.com/julia-vscode/julia-vscode/pull/2783))
* `Revise.revise` is now called in the most recent world during inline evaluation ([#2782](https://github.com/julia-vscode/julia-vscode/pull/2782))

## [1.6.2] - 2022-03-11
### Fixed
* The table viewer is now available even when TableTraits is loaded before we connect to the Julia session, e.g. because it's compiled into the sysimage ([#2775](https://github.com/julia-vscode/julia-vscode/pull/2775))
* Fixed an issue where breakpoints would not get removed from the backend in some circumstancs ([#53](https://github.com/julia-vscode/DebugAdapter.jl/pull/53))

## [1.6.1] - 2022-03-10
### Added
* "Always copy" option for "Connect to external REPL" command ([#2759](https://github.com/julia-vscode/julia-vscode/pull/2759))

### Changed
* Flame graph viewer improvements (scroll up now moves to the parent node, better macOS compatiblity).
* Julia REPL is now properly marked as transient on supported VS Code versions ([#2764](https://github.com/julia-vscode/julia-vscode/pull/2764))

### Fixed
* Julia-specific notebook toolbar icons now only show up for notebooks with Julia kernels ([#2758](https://github.com/julia-vscode/julia-vscode/pull/2758))
* Fixed version incompatibility in debugger ([#52](https://github.com/julia-vscode/DebugAdapter.jl/pull/52))
* Fixed certain `@doc` parsing issues ([#329](https://github.com/julia-vscode/CSTParser.jl/pull/329), [#330](https://github.com/julia-vscode/CSTParser.jl/pull/330))
* Only pass on valid options to JuliaFormatter ([#1030](https://github.com/julia-vscode/LanguageServer.jl/pull/1030))

## [1.6.0] - 2022-02-22
### Added
* New profile viewer with inline annotations ([#2674](https://github.com/julia-vscode/julia-vscode/pull/2674))
* "Execute Code Block in REPL" in editor context menu ([#2667](https://github.com/julia-vscode/julia-vscode/pull/2667))
* Support for `--threads=auto` setting ([#2666](https://github.com/julia-vscode/julia-vscode/pull/2666))

### Changed
* Add config "julia.execution.saveOnEval" to allow auto saving before execution ([#2727](https://github.com/julia-vscode/julia-vscode/pull/2727))
* Add restart REPL command and always stop persistent session option([#2720](https://github.com/julia-vscode/julia-vscode/pull/2720))
* The `julia.NumThreads` setting now allows for a value of `auto` if your Julia versions supports it ([#2666](https://github.com/julia-vscode/julia-vscode/pull/2666))
* Better enum rendering ([#2620](https://github.com/julia-vscode/julia-vscode/pull/2620))
* Improved various notebook functionality ([#2742](https://github.com/julia-vscode/julia-vscode/pull/2742))
* Added stop/restart buttons to REPL workspace ([#2746](https://github.com/julia-vscode/julia-vscode/pull/2746))
* The table viewer now shows the actual Julia type when hovering over the colum header ([#2749](https://github.com/julia-vscode/julia-vscode/pull/2749))

### Fixed
* Weave preview background now follow theme color ([#2740](https://github.com/julia-vscode/julia-vscode/pull/2740))
* Notebooks now respect the thread setting ([#2747](https://github.com/julia-vscode/julia-vscode/pull/2747))
* Fixed rendering of large stacktraces (especially with repeated frames) ([#2746](https://github.com/julia-vscode/julia-vscode/pull/2746))
* `LoadError`s are now properly unwrapped in the REPL ([#2754](https://github.com/julia-vscode/julia-vscode/pull/2754))
* Inline errors are now properly shown even when the line ends with a `;` ([#2748](https://github.com/julia-vscode/julia-vscode/pull/2748))

## [1.5.11] - 2022-01-17
### Fixed
* Fixed a grammar issue when using VS Code 1.64.x ([#2730](https://github.com/julia-vscode/julia-vscode/pull/2730))
* Fixed inline result hovers for VS Code 1.64 and newer ([#2716](https://github.com/julia-vscode/julia-vscode/pull/2716))
* Fixed a Julia REPL crash when getting runtime completions for uninitialized fields ([#2686](https://github.com/julia-vscode/julia-vscode/pull/2686))

### Changed
* Removed some superfluous plot pane related keybindings ([#2704](https://github.com/julia-vscode/julia-vscode/pull/2704))

## [1.5.10] - 2022-01-17
### Fixed
* Fix plot pane location and focus issue, again (hopefully for real this time) ([#2676](https://github.com/julia-vscode/julia-vscode/pull/2676))

## [1.5.9] - 2022-01-05
### Fixed
* Plot pane position is now stable and interactive plots now render properly if the plot pane wasn't opened previously ([#2662](https://github.com/julia-vscode/julia-vscode/pull/2662))
* Fixed various issues with finding the Julia binary ([#2647](https://github.com/julia-vscode/julia-vscode/pull/2647), [#2642](https://github.com/julia-vscode/julia-vscode/pull/2642), [#2658](https://github.com/julia-vscode/julia-vscode/pull/2658))
* Fixed a command registration issue if the Julia binary changes while the language server is starting ([#2663](https://github.com/julia-vscode/julia-vscode/pull/2663))

## [1.5.8] - 2021-12-21
### Fixed
* `juliaup` integration now works properly ([#2374](https://github.com/julia-vscode/julia-vscode/pull/2374))

## [1.5.7] - 2021-12-14
### Fixed
* Code execution in Julia markdown files should now work as intended ([#2584](https://github.com/julia-vscode/julia-vscode/pull/2484))
* Plot pane is now properly confined to its view column ([#2611](https://github.com/julia-vscode/julia-vscode/pull/2611))
* System image building now supports the new manifest format ([#2617](https://github.com/julia-vscode/julia-vscode/pull/2617))
* `=`/`in` normalization for iteration over ranges is now disabled by default ([#1006](https://github.com/julia-vscode/LanguageServer.jl/pull/1006))

### Changed
* Pixelated rendering mode is only active when zooming into an image now ([#2602](https://github.com/julia-vscode/julia-vscode/pull/2602))

## [1.5.6] - 2021-11-20
### Changed
* Cell delimiters for Julia files are now configurable and include `#-` by default ([#2567](https://github.com/julia-vscode/julia-vscode/pull/2567))
* Use pixelated rendering mode for images in the plot pane, in the same way VS Code renders images. ([#2570](https://github.com/julia-vscode/julia-vscode/pull/2570))

### Fixed
* Package tagging should now work again.

## [1.5.5] - 2021-11-16
### Fixed
* Runtime completions can now be properly disabled ([#2551](https://github.com/julia-vscode/julia-vscode/pull/2551))
* Code execution keybindings are now consistent for Weave files ([#2551](https://github.com/julia-vscode/julia-vscode/pull/2551))
* Introduced a helpful warning when `@profview` failed to collect any traces ([#2551](https://github.com/julia-vscode/julia-vscode/pull/2551))
* The REPL is now terminated when VS Code is closed, which should work around issues introduced by the `terminal.integrated.enablePersistentSessions` setting ([#2551](https://github.com/julia-vscode/julia-vscode/pull/2551))
* Fixed various issues with the integrated table viewer ([#2551](https://github.com/julia-vscode/julia-vscode/pull/2551))
* It's now once again possible to use the `Run/Debug in New Process` commands concurrently ([#2551](https://github.com/julia-vscode/julia-vscode/pull/2551))

## [1.5.4] - 2021-11-11
### Changed
* The plot pane now prefers png over svg plots for performance reasons ([#2475](https://github.com/julia-vscode/julia-vscode/pull/2475))

## [1.5.3] - 2021-11-11
### Fixed
* `Execute File` now works properly for Weave files ([#2540](https://github.com/julia-vscode/julia-vscode/pull/2540))
* `"`s are now correctly escaped in the Julia command ([#2546](https://github.com/julia-vscode/julia-vscode/pull/2546))

### Changed
* Improved messaging around LS startup failures ([#2542](https://github.com/julia-vscode/julia-vscode/pull/2542))
* Added a setting for the symbol cache server ([#2547](https://github.com/julia-vscode/julia-vscode/pull/2547))
* Improvements to SymbolServer cache and download responsiveness and performance ([#243](https://github.com/julia-vscode/SymbolServer.jl/pull/243), [#244](https://github.com/julia-vscode/SymbolServer.jl/pull/244))


## [1.5.2] - 2021-11-06
### Changed
* Debugging or running a file in a new process now uses only one terminal ([#2539](https://github.com/julia-vscode/julia-vscode/pull/2539))

## [1.5.0] - 2021-11-05
### Fixed
* `InteractiveUtils` is now properly loaded in notebooks ([#2457](https://github.com/julia-vscode/julia-vscode/pull/2457))
* Runtime diagnostics are now displayed in the REPL in some circumstances ([#2536](https://github.com/julia-vscode/julia-vscode/pull/2536))
* Progress ETA will no longer show NaN or Inf sometimes ([#2536](https://github.com/julia-vscode/julia-vscode/pull/2536))
* Notebook kernels now load the user's startup.jl ([#2536](https://github.com/julia-vscode/julia-vscode/pull/2536))
* `JULIA_NUM_THREADS` and `JULIA_EDITOR` are now correctly set for existing tmux sessions ([#2534](https://github.com/julia-vscode/julia-vscode/pull/2534))
* Inline results now behave properly with CRLF linendings and aren't as easily invalidated by unrelated changes ([#2535](https://github.com/julia-vscode/julia-vscode/pull/2535))
* The error message as now once again properly displayed in notebooks ([#2509](https://github.com/julia-vscode/julia-vscode/pull/2509))
* Fixed various parser issues ([#313](https://github.com/julia-vscode/CSTParser.jl/pull/313), [#315](https://github.com/julia-vscode/CSTParser.jl/pull/315))
* Fixed an erroneous method call error annotation ([#307](https://github.com/julia-vscode/StaticLint.jl/pull/307))
* Fixed a stack overflow in the linter ([#308](https://github.com/julia-vscode/StaticLint.jl/pull/308))
* Fixed a method error in the auto-completion code ([#983](https://github.com/julia-vscode/LanguageServer.jl/pull/983))
* Functors are now correctly displayed in the outline ([#990](https://github.com/julia-vscode/LanguageServer.jl/pull/990), [#995](https://github.com/julia-vscode/LanguageServer.jl/pull/995))
* Fixed an issue with runtime diagnostics crashing the language server ([#996](https://github.com/julia-vscode/LanguageServer.jl/pull/996))
* Various fixes related to inline evaluation ([#2467](https://github.com/julia-vscode/julia-vscode/pull/2467))
* Improved auto-indentation behaviour ([#2459](https://github.com/julia-vscode/julia-vscode/pull/2459))

### Changed
* Improved table viewer UX; added filtering and sorting as well as asynchronous loading of big tables ([#2415](https://github.com/julia-vscode/julia-vscode/pull/2415))
* System image building now excludes development packages (e.g. added by `dev`) ([#2488](https://github.com/julia-vscode/julia-vscode/pull/2488)).
* Extension views are now hidden until the extension is activated ([#2530](https://github.com/julia-vscode/julia-vscode/pull/2530))
* Reduced invalidation in CSTParser.jl, which might improve performance ([#312](https://github.com/julia-vscode/CSTParser.jl/pull/312))
* Majorly improvements to symbol cache loading performance and responsiveness ([#240](https://github.com/julia-vscode/SymbolServer.jl/pull/240), [#241](https://github.com/julia-vscode/SymbolServer.jl/pull/241))
* Language server initialization is now reported much more granularly ([#994](https://github.com/julia-vscode/LanguageServer.jl/pull/994))
* Improved tmux session handling: `Julia: Stop REPL` now shows a prompt for closing the tmux session; also added a `Julia: Disconnect external REPL` command ([#2532](https://github.com/julia-vscode/julia-vscode/pull/2532))
* Julia keybindings now work properly in Weave files ([#2467](https://github.com/julia-vscode/julia-vscode/pull/2467))
* Plot pane interaction now requires the user to hold Alt/Option to avoid conflicts in plot's own mouse event handling ([#2450](https://github.com/julia-vscode/julia-vscode/pull/2450))
* Changed default keybindings for inline/cell evaluation to more closely match the notebook experience ([#2296](https://github.com/julia-vscode/julia-vscode/pull/2296))
* Code formatting is now powered by the excellent [JuliaFormatter.jl](https://github.com/domluna/JuliaFormatter.jl), which should be much more reliable and configurable than the previous formatter ([#2335](https://github.com/julia-vscode/julia-vscode/pull/2334), [#972](https://github.com/julia-vscode/LanguageServer.jl/pull/972))

### Added
* Allow customising precompile statements and execution files for system image building based on a `./.vscode/JuliaSysimage.toml` file inside the project root folder ([#2488](https://github.com/julia-vscode/julia-vscode/pull/2488)).
* tmux session names can now include `$[workspace]` which will be replaced with the name of the current file's workspace when the REPL is first opened. (This allows for multiple persistent sessions across different VSCode windows). ([#2504](https://github.com/julia-vscode/julia-vscode/pull/2504))
* `vscodedisplay` now takes an additional `title` argument, which will be displayed in the tab title for tables ([#2415](https://github.com/julia-vscode/julia-vscode/pull/2415))
* `@vscodedisplay` will automatically put the input expression as the table viewer tab title ([#2533](https://github.com/julia-vscode/julia-vscode/pull/2533))
* Quickaction for removing unused function argument names ([#981](https://github.com/julia-vscode/LanguageServer.jl/pull/981))
* Some runtime-based auto-completions are provided (e.g. for field names and indexing) ([#1507](https://github.com/julia-vscode/julia-vscode/pull/1507))

## [1.4.3] - 2021-09-15
### Changed
* Cursor now changes to indicate that plots are zoomable/panable ([#2445](https://github.com/julia-vscode/julia-vscode/pull/2445))
* Notebook metadata is now properly saved. We've therefore enabled the pure-Julia notebook provider by default and removed the `julia.notebookController` setting ([#2424](https://github.com/julia-vscode/julia-vscode/pull/2424))

## [1.4.2] - 2021-09-10
### Fixed
* Vega and VegaLite plots are now zoomable/panable ([#2443](https://github.com/julia-vscode/julia-vscode/pull/2443))

## [1.4.1] - 2021-09-10
### Fixed
* SVG output is now properly rendered in all cases ([2442](https://github.com/julia-vscode/julia-vscode/pull/2442))

## [1.4.0] - 2021-09-08
### Added
* Export Plot(save/copy) buttons to plot pane([#2267](https://github.com/julia-vscode/julia-vscode/pull/2267))
* Interactive(zoomable/pannable) Plots [#2273](https://github.com/julia-vscode/julia-vscode/pull/2273)
* Add `executeInREPL` to exported API ([#2402](https://github.com/julia-vscode/julia-vscode/pull/2402))
* Added a menu item for enabling/disabling the plot pane ([#2346](https://github.com/julia-vscode/julia-vscode/pull/2346))
* Added support for the custom `application/vnd.julia-vscode.trace` MIME type to display custom runtime diagnostics (e.g. JET.jl output) in the editor ([#2329](https://github.com/julia-vscode/julia-vscode/pull/2329))

### Changed
* `executablePath` is now once again `machine-overridable` thanks to the introduction of *trusted workspaces* ([#2379](https://github.com/julia-vscode/julia-vscode/pull/2379))

### Fixed
* Julia paths are now properly deduplicated ([#2428](https://github.com/julia-vscode/julia-vscode/pull/2428))
* The extension is now activated when Julia specific toolbar items are shown ([#2430](https://github.com/julia-vscode/julia-vscode/pull/2430))
* The play button to run the current file now uses the editor content instead of the file content ([#2431](https://github.com/julia-vscode/julia-vscode/pull/2431))
* Indentation will behave correctly when `end` appears in a for loop definition, e.g. `for i in nums[2:end]` ([#2459](https://github.com/julia-vscode/julia-vscode/pull/2459))

## [1.3.34] - 2021-09-03
### Changed
* Improved error handling for finding the environment path ([#2408](https://github.com/julia-vscode/julia-vscode/pull/2408))
* Limit supported file schemes ([#2410](https://github.com/julia-vscode/julia-vscode/pull/2410))
* Inline evaluation of code blocks ending with a semicolon now don't produce any output ([#2409](https://github.com/julia-vscode/julia-vscode/pull/2409))
* Revert the workaround from 1.3.30 and require VSCode v1.60.0 ([#2394](https://github.com/julia-vscode/julia-vscode/pull/2394))

## [1.3.33] - 2021-08-26
### Changed
* Update vendored plotly to v2.3.1 ([#2376](https://github.com/julia-vscode/julia-vscode/pull/2376))
* Reintroduced `getJuliaPath` to exported API ([#2399](https://github.com/julia-vscode/julia-vscode/pull/2399))

### Fixed
* Images in the plot pane are now correctly down-sized to fit the plot pane again ([#2362](https://github.com/julia-vscode/julia-vscode/pull/2362))

## [1.3.32] - 2021-08-23
### Fixed
* Fixed more argument handling issues when starting Julia processes ([#2372](https://github.com/julia-vscode/julia-vscode/pull/2395))

## [1.3.31] - 2021-08-23
### Changed
* Mention marketplace link in readme ([#2368](https://github.com/julia-vscode/julia-vscode/pull/2368))

### Fixed
* Resolved ambiguity in gridviewer code ([#2382](https://github.com/julia-vscode/julia-vscode/pull/2382))
* Improved argument handling when starting Julia processes ([#2372](https://github.com/julia-vscode/julia-vscode/pull/2372))

## [1.3.30] - 2021-08-15
### Fixed
* Work around an upstream error related to `stat`ing the executable in VSCode tasks ([#2371](https://github.com/julia-vscode/julia-vscode/pull/2371))

## [1.3.29] - 2021-08-14
### Fixed
* Correctness fix for finding the Julia executable ([#2364](https://github.com/julia-vscode/julia-vscode/pull/2364))
* Fix logic for "Open Settings" button in notifications ([#2354](https://github.com/julia-vscode/julia-vscode/pull/2354))
* Reduced bundle size ([#2357](https://github.com/julia-vscode/julia-vscode/pull/2357))

## [1.3.28] - 2021-08-06
### Changed
* Improved code for searching the Julia executable ([#2341](https://github.com/julia-vscode/julia-vscode/pull/2341))
* Add Revise.jl support for notebook evaluation ([#2347](https://github.com/julia-vscode/julia-vscode/pull/2347))

### Fixed
* Notebook execution now correctly uses the same softscope transforms as in Jupyter or the REPL ([#2327](https://github.com/julia-vscode/julia-vscode/pull/2327))
* Internal strict typing improvements ([#2342](https://github.com/julia-vscode/julia-vscode/pull/2342))

## [1.3.27] - 2021-07-29
### Changed
* Improved notebook kernel selection strategy ([#2315](https://github.com/julia-vscode/julia-vscode/pull/2315))

### Fixed
* Notebook restart logic ([#2322](https://github.com/julia-vscode/julia-vscode/pull/2322))

## [1.3.26] - 2021-07-27
### Changed
* Updated dependencies.

## [1.3.23] - 2021-07-26
### Fixed
* REPL prompt hiding logic for inline execution is now more correct ([#2316](https://github.com/julia-vscode/julia-vscode/pull/2316))

## [1.3.20] - 2021-07-25
### Changed
* Native notebook support is now hidden behind the `notebookController` setting because of upstream issues ([#2307](https://github.com/julia-vscode/julia-vscode/pull/2307))
* Better labels for notebook kernels ([#2309](https://github.com/julia-vscode/julia-vscode/pull/2309))
* Notebook cell output is now cleared during re-execution ([#2306](https://github.com/julia-vscode/julia-vscode/pull/2306))

## [1.3.20] - 2021-07-23
### Fixed
* File path is now correctly set for notebooks ([#2305](https://github.com/julia-vscode/julia-vscode/pull/2305))

## [1.3.18] - 2021-07-22
### Changed
* `display` calls that go to alternative displays (like the plot pane) are now more responsive ([#2301](https://github.com/julia-vscode/julia-vscode/pull/2301))
* Download of SymbolServer cache files is now configurable ([#2298](https://github.com/julia-vscode/julia-vscode/pull/2298))
* Improved error message when LS fails to start ([#2295](https://github.com/julia-vscode/julia-vscode/pull/2295))
* Changed the default values of the `completionmode` and `execution.resultType` settings ([#2297](https://github.com/julia-vscode/julia-vscode/pull/2297))

### Fixed
* All logging messages now go to `stderr`, which fixes communication issues on some Julia 1.7 pre-release versions ([#2302](https://github.com/julia-vscode/julia-vscode/pull/2302))


## [1.3.17] - 2021-07-17
### Changed
* Updated dependencies and required VSCode version to v1.58.1

## [1.3.15] - 2021-07-17
### Changed
* Improve Julia notbeook kernel name ([#2275](https://github.com/julia-vscode/julia-vscode/pull/2275))

## [1.3.14] - 2021-07-17
### Added
* Support for preferred kernels ([#2271](https://github.com/julia-vscode/julia-vscode/pull/2271))

### Chaged
* Notebook kernels are now reused after a notebook was closed ([#2257](https://github.com/julia-vscode/julia-vscode/pull/2257))
* Improved notebook display logic ([#2260](https://github.com/julia-vscode/julia-vscode/pull/2260))
* Rely on `os.homedir()` instead of custom ENV logic ([#2263](https://github.com/julia-vscode/julia-vscode/pull/2263))
* Added broadcasting to the list of interpreted Base functions ([#2290](https://github.com/julia-vscode/julia-vscode/pull/2290))

## [1.3.13] - 2021-07-01
### Changed
* Moved to GitHub actions for CI and release pipelines.

## [1.3.2] - 2021-06-30
### Fixed
* Fixed REPL stacktraces file path links for Windows. Paths with tilda symbol now expand to the correct HOMEPATH. Paths with spaces are handled correctly ([#2261](https://github.com/julia-vscode/julia-vscode/pull/2261))

## [1.3.0] - 2021-06-29
### Added
* Native notebook support ([#2217](https://github.com/julia-vscode/julia-vscode/pull/2217) and others)

### Changed
* Environment variables are now resolved in the `julia.environmentPath` and `julia.executablePath` settings ([#2153](https://github.com/julia-vscode/julia-vscode/pull/2153))

### Fixed
* Julia 1.6 paths on Windows are now correct ([#2251](https://github.com/julia-vscode/julia-vscode/pull/2251))
* Fixed various packaging issues ([#2229](https://github.com/julia-vscode/julia-vscode/pull/2229))

## [1.2.5] - 2021-06-18
### Fixed
* Compiled modules/mode/functions are now set properly in the out-of-process deubugger ([#2226](https://github.com/julia-vscode/julia-vscode/pull/2226))
* Improved plot navigator robustness ([#2221](https://github.com/julia-vscode/julia-vscode/pull/2221))

## [1.2.4] - 2021-06-09
### Changed
* Update various dependencies

## [1.2.3] - 2021-06-07
### Fixed
* Various debugging related issues ([#39](https://github.com/julia-vscode/DebugAdapter.jl/pull/39), [#2190](https://github.com/julia-vscode/julia-vscode/pull/2190))
* Plot assets are now correctly loaded ([#2200](https://github.com/julia-vscode/julia-vscode/pull/2200))

## [1.2.2] - 2021-06-01
### Changed
* `Julia: Connect external REPL` now gives feedback when connected ([#2182](https://github.com/julia-vscode/julia-vscode/pull/2182))

### Fixed
* Tilde-expansion now properly works in terminal links ([#2185](https://github.com/julia-vscode/julia-vscode/pull/2185))
* REPL hooks are now properly installed when connecting to already running processes ([#2182](https://github.com/julia-vscode/julia-vscode/pull/2182))
* `tmux` integration and connecting to an external process now properly work on Windows ([#2182](https://github.com/julia-vscode/julia-vscode/pull/2182))

## [1.2.1] - 2021-05-27
### Fixed
* `tmux` integration now works ([#2177](https://github.com/julia-vscode/julia-vscode/pull/2177))
* Fixed a crash in the new multi-environment support ([#945](https://github.com/julia-vscode/LanguageServer.jl/pull/945))
* The plots pane and navigator now (mostly) keeps focus where it was before ([#2172](https://github.com/julia-vscode/julia-vscode/pull/2174))

## [1.2.0] - 2021-05-26
### Fixed
* Non-debugging Julia sessions no longer pretend they are debug sessions ([#2155](https://github.com/julia-vscode/julia-vscode/pull/2155))
* Loading internal code now works better when multiple processes have been added in `startup.jl` ([#2147](https://github.com/julia-vscode/julia-vscode/pull/2147))

### Changed
* Workspace panel now shows `#properties` for `AbstractrArray`s and `AbstractDict`s ([#1927](https://github.com/julia-vscode/julia-vscode/pull/1927))
* Clicking on a symbol now highlights only references to that symbol, instead of all symbols with the same name ([#908](https://github.com/julia-vscode/LanguageServer.jl/pull/908))

### Added
* Added a sidebar element to quickly switch between differen plots ([#1932](https://github.com/julia-vscode/julia-vscode/pull/1932))
* Added integration for persistent `tmux` sessions, especially useful together with the Remote Editing extension ([#1893](https://github.com/julia-vscode/julia-vscode/pull/1893))
* Ship CoverageTools.jl as part of the extension so that test runs with coverage always work ([#1928](https://github.com/julia-vscode/julia-vscode/pull/1928))
* Add option to delete .cov files after test runs (on by default) ([#1928](https://github.com/julia-vscode/julia-vscode/pull/1928))
* Add new completion modes for unexported variables ([#1963](https://github.com/julia-vscode/julia-vscode/pull/1963), [#892](https://github.com/julia-vscode/LanguageServer.jl/pull/892))
* New option for showing results inline but echoing errors into the REPL ([#2121](https://github.com/julia-vscode/julia-vscode/pull/2121))
* New UI for setting compiled/interpreted methods for the debugger, which can allow for a significantly faster debugging experience ([#1888](https://github.com/julia-vscode/julia-vscode/pull/1888), [#31](https://github.com/julia-vscode/DebugAdapter.jl/pull/31))
* Auto-completion of un-exported symbols can now optionally insert the appropriate `using` statement ([#892](https://github.com/julia-vscode/LanguageServer.jl/pull/892))

## [1.1.39] - 2021-05-06
### Fixed
* Inline stacktraces are now rendered properly on Julia 1.6 ([#2091](https://github.com/julia-vscode/julia-vscode/pull/2091))
* Weaving a document now respects the current env ([#2130](https://github.com/julia-vscode/julia-vscode/pull/2130))
* `ARGS` are now properly cleared of extension internals ([#2090](https://github.com/julia-vscode/julia-vscode/pull/2090))
* External Julia processes now respect the number of threads setting ([#2141](https://github.com/julia-vscode/julia-vscode/pull/2141))
* URIs in markdown hovers (e.g. in stacktraces) now properly link to the right line ([#932](https://github.com/julia-vscode/LanguageServer.jl/pull/932))

### Changed
* Added support for the error stacks introduced in Julia 1.5 ([#2142](https://github.com/julia-vscode/julia-vscode/pull/2142))
* Improvements to the package tagging functionality (which is now also limited to Julia 1.6) ([#2144](https://github.com/julia-vscode/julia-vscode/pull/2144))

### Added
* The linter now understands the new `import Foo as Bar` syntax ([#276](https://github.com/julia-vscode/StaticLint.jl/pull/276))

## [1.1.38] - 2021-03-29
### Fixed
* Path for auto-detecting Julia 1.6 binaries on Windows are now correct ([#2086](https://github.com/julia-vscode/julia-vscode/pull/2086))
* Added auto-dection for 1.6.1 ([#2076](https://github.com/julia-vscode/julia-vscode/pull/2076))
* Setting `JULIA_EDITOR` should now be more robust ([#2067](https://github.com/julia-vscode/julia-vscode/pull/2067))

### Changed
* Auto-completions now allow for a certain degree of fuzzyiness ([#906](https://github.com/julia-vscode/LanguageServer.jl/pull/906))

### Added
* The LS now support selection range requests (use `Shift-Alt-Right`/`Shift-Alt-Left` to expand/reduce the "smart selection" in VSCode) ([#893](https://github.com/julia-vscode/LanguageServer.jl/pull/893))

## [1.1.37] - 2021-03-17
### Fixed
* Fixed a security vulnerability related to the Julia path setting ([#2062](https://github.com/julia-vscode/julia-vscode/pull/2062))
* We should not leave any more orphaned processes behind when VSCode is closed unexpectedly ([#48](https://github.com/julia-vscode/JSONRPC.jl/pull/48))

## [1.1.35] - 2021-03-12
### Changed
* The Julia grammar is now shipped by VSCode and therefore removed from this package ([#1998](https://github.com/julia-vscode/julia-vscode/pull/1998))
* Error handling for internal Julia code should now be more robust ([#2015](https://github.com/julia-vscode/julia-vscode/pull/2015))

## [1.1.34] - 2021-03-09
### Fixed
* Work around a Base issue when displaying certain types in the REPL ([#2010](https://github.com/julia-vscode/julia-vscode/pull/2010))
* Fixed certain debugger commands not working properly ([#2008](https://github.com/julia-vscode/julia-vscode/pull/2008))

## [1.1.33] - 2021-03-06
### Fixed
* Step Into Target now works properly for top-level frames ([#34](https://github.com/julia-vscode/DebugAdapter.jl/pull/34))

### Changed
* "Run Code" commands now conform to the VSCode guidelines ([#1999](https://github.com/julia-vscode/julia-vscode/pull/1999))

## [1.1.32] - 2021-03-03
### Changed
* Pipes for communication between the VSCode extension host and various Julia processes are now guaranteed to be unique ([#1980](https://github.com/julia-vscode/julia-vscode/pull/1980))
* REPL output form activating a new environment via the GUI now doesn't display a Julia prompt ([#1981](https://github.com/julia-vscode/julia-vscode/pull/1981))
* Better crash reporting when commands fail ([#1985](https://github.com/julia-vscode/julia-vscode/pull/1985))

## [1.1.29] - 2021-02-23
### Fixed
* Fixed a typo that made the more robust REPL hooks not very robust at all ([#1973](https://github.com/julia-vscode/julia-vscode/pull/1973))
* Fixed a rare bug where showing variables while debugging might result in a crash ([#32](https://github.com/julia-vscode/DebugAdapter.jl/pull/32))

## [1.1.28] - 2021-02-23
### Fixed
* LaTeX-rendered equations are now properly hidden behind the search bar in the docs pane([#1970](https://github.com/julia-vscode/julia-vscode/pull/1970))
* REPL hooks are now more robust ([#1968](https://github.com/julia-vscode/julia-vscode/pull/1968))

## [1.1.26] - 2021-02-20
### Fixed
* Unparametrize the wrapper introduced in #1943 ([#1957](https://github.com/julia-vscode/julia-vscode/pull/1957))

### Changed
* Debugger is no longer marked as experimental ([#1965](https://github.com/julia-vscode/julia-vscode/pull/1965))
* We now use the `ast_transforms` machinery introduced in Julia 1.5 when appicable ([#1959](https://github.com/julia-vscode/julia-vscode/pull/1959))

## [1.1.19 - 1.1.25] - 2021-02-17
### Changed
* Fixes to our Azure Pipelines infracstructure

## [1.1.18] - 2021-02-15
### Fixed
* Fixed a regression when displaying SVGs in the plot pane ([#1939](https://github.com/julia-vscode/julia-vscode/pull/1939))
* Fix an issue with displaying values with incorrect `convert` methods ([#1943](https://github.com/julia-vscode/julia-vscode/pull/1943))

### Changed
* Explorer context menu entries are now only shown when a REPL is running ([#1933](https://github.com/julia-vscode/julia-vscode/pull/1933))

## [1.1.16] - 2021-02-09
### Added
* Julia 1.6 binaries are now auto-detected ([#1918](https://github.com/julia-vscode/julia-vscode/pull/1918))

## [1.1.14] - 2021-02-03
### Fixed
* Removed references to outdated Julia syntax that caused incorrect auto-indentation ([#1910](https://github.com/julia-vscode/julia-vscode/pull/1910))
* Stacktraces should now be properly truncated again ([#1912](https://github.com/julia-vscode/julia-vscode/pull/1912))

### Changed
* Updated the vendored Plotly and fixed auto-resizing for Plotly and VegaLite plots ([#1911](https://github.com/julia-vscode/julia-vscode/pull/1911))

## [1.1.13] - 2021-02-03
### Fixed
* Relative environment paths are now persisted properly ([#1905](https://github.com/julia-vscode/julia-vscode/pull/1905))
* User supplied environment paths are now checked for validity ([#1907](https://github.com/julia-vscode/julia-vscode/pull/1907))

## [1.1.12] - 2021-02-02
### Fixed
* Corrected environment handling in certaing cases ([#1903](https://github.com/julia-vscode/julia-vscode/pull/1903))

### Changed
* Live testing is disabled until it can be fixed ([#1902](https://github.com/julia-vscode/julia-vscode/pull/1902))

## [1.1.11] - 2021-01-31
### Fixed
* Getting the module at the current cursor position now no longer waits until the LS is started ([#1892](https://github.com/julia-vscode/julia-vscode/pull/1892))

## [1.1.10] - 2021-01-28
### Fixed
* Stop throwing an error instead of waiting for the LS being ready ([#1889](https://github.com/julia-vscode/julia-vscode/pull/1889)).
* Fixed an issue with formatting `if` conditions ([#124](https://github.com/julia-vscode/DocumentFormat.jl/pull/124)).

## [1.1.9] - 2021-01-26
### Fixed
* Displaying profiler results now works again ([#1887](https://github.com/julia-vscode/julia-vscode/pull/1887)).

## [1.1.7] - 2021-01-26
### Fixed
* `pwd` is now properly set for the live unit testing task ([#1886](https://github.com/julia-vscode/julia-vscode/pull/1886)).

## [1.1.6] - 2021-01-25
### Changed
* The plot pane now properly scales images ([#1882](https://github.com/julia-vscode/julia-vscode/pull/1882)).

### Fixed
* The LS now correctly handles the `$/setTrace` notification ([#868](https://github.com/julia-vscode/LanguageServer.jl/pull/868)).

## [1.1.0] - 2021-01-23
### Changed
* The progress bar now shows an estimate of the remaining time ([#1868](https://github.com/julia-vscode/julia-vscode/pull/1868)).

## [1.0.15] - 2021-01-23
### Added
* Progress logging can now be disabled in the settings ([#1867](https://github.com/julia-vscode/julia-vscode/pull/1867)).
* The Julia explorer sidebar element now contains a documentation browser ([#1458](https://github.com/julia-vscode/julia-vscode/pull/1458)).
* Added a command for tagging new package versions ([#1870](https://github.com/julia-vscode/julia-vscode/pull/1870)).
* Added a task for live unit testing ([#1872](https://github.com/julia-vscode/julia-vscode/pull/1872)).

### Changed
* The LS depot path is now located in the extension global storage instead of the extension's install directory, which allows the latter to be read-only ([#1863](https://github.com/julia-vscode/julia-vscode/pull/1863)).
* Improve docstring formatting ([#122](https://github.com/julia-vscode/DocumentFormat.jl/pull/122)).

### Fixed
* Comments and whitespace in multi-line tuples are no longer removed when formatting a file ([#121](https://github.com/julia-vscode/DocumentFormat.jl/pull/121)).

## [1.0.14] - 2021-01-16
### Changed
* Removed the telemtry nag message ([#1676](https://github.com/julia-vscode/julia-vscode/pull/1676)).
* Removed `@` and `!` from the list of non-word characters, so double clicking `@foo!` now selects the whole macro ([#1861](https://github.com/julia-vscode/julia-vscode/pull/1861)).

### Fixed
* Improved the algorithm for finding the current code block ([#860](https://github.com/julia-vscode/LanguageServer.jl/pull/860)).
* Fixed jmd parsing ([#859](https://github.com/julia-vscode/LanguageServer.jl/pull/859)).
* THe linter now doesn't attribute every `eval` call to `Core.eval` ([#237](https://github.com/julia-vscode/StaticLint.jl/pull/237)).

## [1.0.13] - 2021-01-13
### Added
* It is now possible to customize the look of inline results ([#1846](https://github.com/julia-vscode/julia-vscode/pull/1846)).
* Support for the upcoming `import Foo as Bar` syntax ([#220](https://github.com/julia-vscode/CSTParser.jl/pull/220)).

### Changed
* Switched to a new symbol store format ([#1857](https://github.com/julia-vscode/julia-vscode/pull/1857)).
* Major rewrite for CSTParser ([#190](https://github.com/julia-vscode/CSTParser.jl/pull/190)).
* StaticLint.jl now supports Julia >= v1.6 ([#227](https://github.com/julia-vscode/StaticLint.jl/pull/228)).
* Added additional type inference for the linter ([#234](https://github.com/julia-vscode/StaticLint.jl/pull/234)).

### Fixed
* We now use the correct binary when setting the `JULIA_EDITOR` on MacOS for users of VSCode insiders ([#1852](https://github.com/julia-vscode/julia-vscode/pull/1852)).
* `Base.displayble` is now correctly extended instead of creating a local version ([#1856](https://github.com/julia-vscode/julia-vscode/pull/1856)).
* Conditions for line breakpoints now work again ([#26](https://github.com/julia-vscode/DebugAdapter.jl/pull/26)).
* Debugger now correctly unwraps `UnionAll`s when collecting global refs ([#27](https://github.com/julia-vscode/DebugAdapter.jl/pull/27)).
* The Linter now correctly handles `Base.@kwdef` ([#233](https://github.com/julia-vscode/StaticLint.jl/pull/233)).

## [1.0.12] - 2021-01-05
### Added
* Commands for moving between code cells ([#1828](https://github.com/julia-vscode/julia-vscode/pull/1828)).

### Fixed
* Backtraces are now properly truncated in the REPL ([#1841](https://github.com/julia-vscode/julia-vscode/pull/1841)).

## [1.0.11] - 2020-12-15
### Added
* Debugging or launching a file now works in workspaces with more than one directory ([#1789](https://github.com/julia-vscode/julia-vscode/pull/1789)).
* Pressing `^C` more than three times in one second now sends a `SIGINT` to the Julia process (on non-Windows OSs), which should make for more robust interrupts ([#1775](https://github.com/julia-vscode/julia-vscode/pull/1775)).

### Changed
* Inline evaluation now waits for the LS to start up instead of throwing an error ([#1760](https://github.com/julia-vscode/julia-vscode/pull/1760)).
* `julia.environmentPath` needs a REPL restart, so added a note to that effect ([#1778](https://github.com/julia-vscode/julia-vscode/pull/1778)).
* The `language-julia.executeFile` command can now be called with a string argument for easy integration with custom keybindings ([#1779](https://github.com/julia-vscode/julia-vscode/pull/1779)).
* Commands that require finding Julia environment files now don't need a running REPL ([#1757](https://github.com/julia-vscode/julia-vscode/pull/1757)).
* When using inline evaluation commands that move the cursor after evaluation, the cursor is now only moved if the user hasn't interacted with it ([#1774](https://github.com/julia-vscode/julia-vscode/pull/1774)).
* Debugging in a new process now properly loads the user's `startup.jl` ([#1806](https://github.com/julia-vscode/julia-vscode/pull/1806)).
* Update to JuliaInterpreter.jl 0.8 ([#24](https://github.com/julia-vscode/DebugAdapter.jl/pull/24)).

### Fixed
* There can only be one LS startup notification ([#1798](https://github.com/julia-vscode/julia-vscode/pull/1789)).
* Plots are now properly displayed when the plot pane is disabled and only inline results are enabled ([#1795](https://github.com/julia-vscode/julia-vscode/pull/1797)).
* Added some error handling when displaying error stacktraces inline ([#1802](https://github.com/julia-vscode/julia-vscode/pull/1802)).
* The attached debugger now properly sets `tls[:source_path]` and doesn't crash the Julia REPL on errors ([#1804](https://github.com/julia-vscode/julia-vscode/pull/1804)).
* Staktraces are now properly truncated for inline results ([#1812](https://github.com/julia-vscode/julia-vscode/pull/1812)).
* Progress messages are now properly flushed, so that the progress monitoring is always be up-to-date ([#1805](https://github.com/julia-vscode/julia-vscode/pull/1805)).
* Fixed an issue with parsing kwfuncs using `where` ([#212](https://github.com/julia-vscode/CSTParser.jl/pull/212)).
* Added missing `nothing` checks that could cause issues when linting files ([#221](https://github.com/julia-vscode/StaticLint.jl/pull/221), [#223](https://github.com/julia-vscode/StaticLint.jl/pull/223)).

## [1.0.10] - 2020-11-13
### Added
* Support for Julia 1.5.3 and 1.5.4 default installation paths ([#1755](https://github.com/julia-vscode/julia-vscode/pull/1755), [#1759](https://github.com/julia-vscode/julia-vscode/pull/1759)).
* New up-to-date changelog ([#1750](https://github.com/julia-vscode/julia-vscode/pull/1750)).

### Changed
* Inline evaluation now adds the evaluated code to the REPL history *if* the `julia.codeInREPL` options is set ([#1754](https://github.com/julia-vscode/julia-vscode/pull/1754)).
* The extension now watches the global Manifest as well as Manifests in the workspace for changes and prompts the LS to re-index accordingly ([#1756](https://github.com/julia-vscode/julia-vscode/pull/1756)).

### Fixed
* Push internal Julia modules to the front of `LOAD_PATH` to prevent loading code from the workspace instead ([#1747](https://github.com/julia-vscode/julia-vscode/pull/1747)).
* Fixed a typo in the tableviewer code ([#1749](https://github.com/julia-vscode/julia-vscode/pull/1749)).
* Evaluation now uses unbuffered channels for communication, which might fix a rare off-by-one-result bug ([#1762](https://github.com/julia-vscode/julia-vscode/pull/1762)).

## [1.0.9] - 2020-11-04
### Added
* The workspace now shows errors encountered while rendering the tree view. Furthermore, it now only special cases `Array` and `Dict` instead of their `Abstract...` supertypes ([#1709](https://github.com/julia-vscode/julia-vscode/pull/1709)).
* Inline evaluation and the REPL can now be interrupted with the `Julia: Interrupt Execution` comamnd (or its default keyboard binding <kbd>ctrl+c</kbd>) ([#1690](https://github.com/julia-vscode/julia-vscode/pull/1690)).
* [ProgressLogging.jl](https://github.com/JunoLab/ProgressLogging.jl)'s progress bars are now displayed in the editor ([1579](https://github.com/julia-vscode/julia-vscode/pull/1579)).
* The language server process is now started with the `JULIA_LANGUAGESERVER` environment variable set to `1` ([#1707](https://github.com/julia-vscode/julia-vscode/pull/1707)).
* Added commands to re-start the LS or re-index the symbol cache ([#1721](https://github.com/julia-vscode/julia-vscode/pull/1721)).
* `@edit` now works properly on [code-server](https://github.com/cdr/code-server) instances ([#1737](https://github.com/julia-vscode/julia-vscode/pull/1737)).
* Added commands to `cd` to the current directory, `Pkg.activate` the current directory, or `Pkg.activate` the current files nearest project. These commands are also available in the file explorer ([#1743](https://github.com/julia-vscode/julia-vscode/pull/1743)).

### Changed
* Updated some JS dependencies.
* The plot pane is now opened in a new column by default, but also remembers it's last position ([#1554](https://github.com/julia-vscode/julia-vscode/pull/1554)).
* The `julia.NumThreads` setting is now machine-overrideable ([#1714](https://github.com/julia-vscode/julia-vscode/pull/1714)).
* Updated the Julia grammar definition ([#1720](https://github.com/julia-vscode/julia-vscode/pull/1720)), which [fixed various bugs](https://github.com/JuliaEditorSupport/atom-language-julia/compare/v0.19.3...v0.20.0).
* `julia.usePlotPane` can now be changed without requiring the Julia process to be restarted. Additionally, the related `display` machinery is now much more robust ([#1729](https://github.com/julia-vscode/julia-vscode/pull/1729)).
* The "play" button in the editor toolbar now runs the file in the integrated REPL process ([#1728](https://github.com/julia-vscode/julia-vscode/pull/1728)).
* All inline results are now removed when the REPL process exits ([#1738](https://github.com/julia-vscode/julia-vscode/pull/1738)).

### Fixed
* Stracktraces are now rendered properly (i.e. with linebreaks) once again ([#1692](https://github.com/julia-vscode/julia-vscode/pull/1692)).
* The module indicator is now correctly initialized (instead of `Main`) ([#1516](https://github.com/julia-vscode/julia-vscode/pull/1516)).

## [1.0.8] - 2020-10-16
### Changed
* Both inline evaluation and the REPL now follow the changed soft-scope rules for Julia 1.5 and newer ([#1665](https://github.com/julia-vscode/julia-vscode/pull/1665)).

## [1.0.7] - 2020-10-05
### Changed
* Updated JS dependencies.
* We now show an error message when both insiders and the regular extension are loaded.

## [1.0.6] - 2020-09-29
### Changed
* Updated JS dependencies.

## [1.0.5] - 2020-09-27
### Added
* Default paths for Julia 1.5.1 and 1.5.2.

## [1.0.4] - 2020-09-18
### Added
* `JULIA_PKG_SERVER` is now an exposed setting.
* `Julia: Stop REPL` command.

### Changed
* Toolbar icon now follows the style guide (outline instead of filled).

### Fixed
* Run/Debug commands now work when invoked from the command palette.

## [1.0.3] - 2020-09-06
### Fixed
* `ARGS` now no longer contains extension internals.
* Use correct default path for Julia 1.5.
* Fixed a world age error when using the integrated table viewer.

### Changed
* Revise is now loaded without stealing the REPL backend for newer Julia versions.
* `#%%` and `# %%` are now valid cell seperators.
* Improved crash reporting.

## [1.0.2] - 2020-09-01
### Changed
* Improved Azure build pipeline
* Updated some JS dependencies

## [1.0.1] - 2020-08-31
### Added
* This plugin is now also available on [open-vsx.org](https://open-vsx.org/extension/julialang/language-julia)

## [1.0.0] - 2020-08-28
This is identical to the latest 0.17 release.

## [0.17]
* Global variable support in the debugger variable explorer
* Debug and run buttons above Julia files
* Support for step in targets in the debugger
* Profile viewing support
* Stackframe highlighting for inline evaluations
* Configuration option to exclude folders from linting
* Add an extension API

## [0.16]
* Inline display of evaluation results
* Workspace view

## [0.15]
* Add an experimental debugger
* Improve cell delimiter regex so that it won't recognize YAS-style section headers as cell separator anymore (#1256, #1259)

## [0.14]
* Make Language Server indexing async
* New linting capabilities: call checks, static `if` blocks, unused free parameters, unhandled `include` statements, clashing module names, and [pirates](https://docs.julialang.org/en/v1/manual/style-guide/index.html#Avoid-type-piracy-1).
* Enable [Code Actions](https://code.visualstudio.com/docs/editor/refactoring): explicit re-export, replace qualified names with using statements
* Add support for Julia 1.4/5-DEV
* Improved robustness, e.g. handling of unicode
* Better presentation of documentation
* Fully implement LSP 3.14
* StaticLint: improved path handling (file tree), extended macro handling, handle local/global variables, general refactor with speed/robustness improvements

## [0.13.1]
* Update CHANGELOG

## [0.13.0]
* Support for Julia 1.3
* Configuration options for the code formatter
* Bug fixes

## [0.12.3]
* Add support for running a selection with Alt+Enter
* Fix a bug in the LS when an environment path doesn't exist
* Clean up labeling of commands

## [0.12.2]
* Various bug fixes

## [0.12.1]
* Various bug fixes

## [0.12.0]
* Add `vscodedisplay()` function for a grid view of tables
* Add a command to delete all plots from the plot pane
* Store Julia environment choice in settings
* Auto detect Julia environments
* Change how execute block sends code to the REPL
* Preserve focus of REPL when plot pane is shown
* Fix weave preview
* Make tasks work with julia environments
* Add a test task that outputs coverage information
* Open docs after build task
* Support vega 3, 4 and 5, and vega-lite 2 and 3
* Allow paths starting with ~ for julia bin location
* Fix JULIA_EDITOR integration on Mac
* Add support for custom sysimages
* Reworked syntax highlighting
* Add support for code cell execution with Shift+Enter

## [0.11.6]
* Add option to permanently opt out of crash reporting
* Fix bug related to Revise integration
* Add option for passing command line arguments to julia REPL process
* Rework communication between REPL and extension
* Auto-detect julia 1.1.1 and 1.2.0

## [0.11.5]
* Fix julia 1.1 compat issue in SymbolServer
* Update vega-lite to 3.0 and vega to 5.2

## [0.11.4]
* Fix another julia 1.1 compat issue

## [0.11.3]
* Fix julia 1.1 compat issue

## [0.11.2]
* Various bug fixes
* Add option to enable/disable plot pane
* Search for julia 1.0.4 and 1.1

## [0.11.1]
* Update CHANGELOG

## [0.11.0]
* Add julia 1.0 support, drop julia 0.6 support
* Add support for interactive Plotly figures
* Various bugfixes

## [0.10.2]
* Fix automatic julia detection on Mac

## [0.10.1]
* Fix some small bugs

## [0.10.0]
* Auto-detect julia installation
* Telemetry support
* Crash reporting
* Fix weave support
* Various bug fixes

## [0.9.1]
* Update changelog

## [0.9.0]
* Enable multi-root workspace support
* Bug fixes

## [0.8.0]
* Add eval into module option to REPL
* Add toggle lint command
* Add toggle log command
* Add execute file command
* Add execute block command
* Add support for region folding
* Bug fixes

## [0.7.0]
* Use VS Code tasks for build, test and benchmark
* Add reload modules command
* Add rename command
* Bug fixes

## [0.6.2]
* Bug fixes
* Language server status bar icon
* julia 0.6 syntax highlighting

## [0.6.1]
* Bug fixes

## [0.6.0]
* Use LanguageServer.jl
* Format Document command
* Actionable diagnostics
* Support for .jmd files
* Plot pane
* Run package tests command
* Lint package command

## [0.5.1]

* Scope Ctrl+Enter to julia files
* Fix whitespace bug on Windows

## [0.5.0]

* Migrate to a language server protocol design
* Add completion provider
* Add definition provider
* Add hover provider
* Add signature provider
* Add integrated julia terminal

## [0.4.2]

* julia 0.5 compatibility

## [0.4.1]

* Update README

## [0.4.0]

* Add linter support

## [0.3.1]

* Patch release to test upgrade procedure

## [0.3.0]

* Add latex completion

## [0.2.0]

* Add "Open Package Directory in New Window" command

## [0.1.1]

* Update project home URLs

## [0.1.0]

* Initial release
