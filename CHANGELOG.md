# Change Log

All notable changes to the Julia extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
### Added
* Export Plot(save/copy) buttons to plot pane([#2267](https://github.com/julia-vscode/julia-vscode/pull/2267))
* Interactive(zoomable/pannable) Plots [#2273](https://github.com/julia-vscode/julia-vscode/pull/2273)

### Fixed
* Fixed REPL stacktraces file path links for Windows. Paths with tilda symbol now expand to the correct HOMEPATH. Paths with spaces are handled correctly ([#2261](https://github.com/julia-vscode/julia-vscode/pull/2261))

### Changed
* `Julia: Connect external REPL` now gives feedback when connected ([#2182](https://github.com/julia-vscode/julia-vscode/pull/2182))

### Fixed
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
