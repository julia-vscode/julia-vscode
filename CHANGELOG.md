# Changelog

## 0.17
* Global variable support in the debugger variable explorer
* Debug and run buttons above Julia files
* Support for step in targets in the debugger
* Profile viewing support
* Stackframe highlighting for inline evaluations
* Configuration option to exclude folders from linting
* Add an extension API

## 0.16
* Inline display of evaluation results
* Workspace view

## 0.15
* Add an experimental debugger
* Improve cell delimiter regex so that it won't recognize YAS-style section headers as cell separator anymore (#1256, #1259)

## 0.14
* Make Language Server indexing async
* New linting capabilities: call checks, static `if` blocks, unused free parameters, unhandled `include` statements, clashing module names, and [pirates](https://docs.julialang.org/en/v1/manual/style-guide/index.html#Avoid-type-piracy-1).
* Enable [Code Actions](https://code.visualstudio.com/docs/editor/refactoring): explicit re-export, replace qualified names with using statements
* Add support for Julia 1.4/5-DEV
* Improved robustness, e.g. handling of unicode
* Better presentation of documentation
* Fully implement LSP 3.14
* StaticLint: improved path handling (file tree), extended macro handling, handle local/global variables, general refactor with speed/robustness improvements

## 0.13.1
* Update CHANGELOG

## 0.13.0
* Support for Julia 1.3
* Configuration options for the code formatter
* Bug fixes

## 0.12.3
* Add support for running a selection with Alt+Enter
* Fix a bug in the LS when an environment path doesn't exist
* Clean up labeling of commands

## 0.12.2
* Various bug fixes

## 0.12.1
* Various bug fixes

## 0.12.0
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

## 0.11.6
* Add option to permanently opt out of crash reporting
* Fix bug related to Revise integration
* Add option for passing command line arguments to julia REPL process
* Rework communication between REPL and extension
* Auto-detect julia 1.1.1 and 1.2.0

## 0.11.5
* Fix julia 1.1 compat issue in SymbolServer
* Update vega-lite to 3.0 and vega to 5.2

## 0.11.4
* Fix another julia 1.1 compat issue

## 0.11.3
* Fix julia 1.1 compat issue

## 0.11.2
* Various bug fixes
* Add option to enable/disable plot pane
* Search for julia 1.0.4 and 1.1

## 0.11.1
* Update CHANGELOG

## 0.11.0
* Add julia 1.0 support, drop julia 0.6 support
* Add support for interactive Plotly figures
* Various bugfixes

## 0.10.2
* Fix automatic julia detection on Mac

## 0.10.1
* Fix some small bugs

## 0.10.0
* Auto-detect julia installation
* Telemetry support
* Crash reporting
* Fix weave support
* Various bug fixes

## 0.9.1
* Update changelog

## 0.9.0
* Enable multi-root workspace support
* Bug fixes

## 0.8.0
* Add eval into module option to REPL
* Add toggle lint command
* Add toggle log command
* Add execute file command
* Add execute block command
* Add support for region folding
* Bug fixes

## 0.7.0
* Use VS Code tasks for build, test and benchmark
* Add reload modules command
* Add rename command
* Bug fixes

## 0.6.2
* Bug fixes
* Language server status bar icon
* julia 0.6 syntax highlighting

## 0.6.1
* Bug fixes

## 0.6.0
* Use LanguageServer.jl
* Format Document command
* Actionable diagnostics
* Support for .jmd files
* Plot pane
* Run package tests command
* Lint package command

## 0.5.1

* Scope Ctrl+Enter to julia files
* Fix whitespace bug on Windows

## 0.5.0

* Migrate to a language server protocol design
* Add completion provider
* Add definition provider
* Add hover provider
* Add signature provider
* Add integrated julia terminal

## 0.4.2

* julia 0.5 compatibility

## 0.4.1

* Update README

## 0.4.0

* Add linter support

## 0.3.1

* Patch release to test upgrade procedure

## 0.3.0

* Add latex completion

## 0.2.0

* Add "Open Package Directory in New Window" command

## 0.1.1

* Update project home URLs

## 0.1.0

* Initial release
