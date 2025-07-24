# Julia
[![Build and Test](https://github.com/julia-vscode/julia-vscode/actions/workflows/main.yml/badge.svg)](https://github.com/julia-vscode/julia-vscode/actions/workflows/main.yml)
[![Docs](https://img.shields.io/badge/docs-latest-blue.svg)](https://www.julia-vscode.org/docs/latest/)
<!-- [![Docs](https://img.shields.io/badge/docs-dev-blue.svg)](https://www.julia-vscode.org/docs/dev/) -->

This [VS Code](https://code.visualstudio.com) extension provides support for the [Julia programming language](http://julialang.org/).

## Getting started

### Installing Julia/VS Code/VS Code Julia extension
1. Install Julia for your platform: https://julialang.org/downloads/
2. Install VS Code for your platform: https://code.visualstudio.com/download
    At the end of this step you should be able to start VS Code.
3. Choose `Install` in the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=julialang.language-julia); or paste in browser's address bar to open this direct VS Code link `vscode:extension/julialang.language-julia` or manually install with:
    1. Start VS Code.
    2. Inside VS Code, go to the extensions view either by
        executing the ``View: Show Extensions`` command (click View->Command Palette...)
        or by clicking on the extension icon on the left side of the VS Code
        window.
    3. In the extensions view, simply search for the term ``julia`` in the marketplace
        search box, then select the extension named ``Julia`` and click the install button.
        You might have to restart VS Code after this step.

### Configure the Julia extension

If you have installed Julia into a standard location on Mac or Windows, or
if the Julia binary is on your ``PATH``, the Julia VS Code extension should
automatically find your Julia installation and you should not need to
configure anything.

If the extension does not find your Julia installation automatically, or
if you want to use a different Julia installation than the default one,
you can set the ``julia.executablePath`` to point to the Julia executable
that the extension should use. In that case the
extension will always use that version of Julia. To edit your configuration
settings, execute the ``Preferences: Open User Settings`` command (you can
also access it via the menu ``File->Preferences->Settings``), and
then make sure your user settings include the ``julia.executablePath``
setting. The format of the string should follow your platform specific
conventions, and be aware that the backlash ``\`` is the escape character
in JSON, so you need to use ``\\`` as the path separator character on Windows.

## Features

The extension currently provides:

* syntax highlighting
* [snippets: latex and user-shared snippets](https://github.com/julia-vscode/julia-vscode/wiki/Snippets)
* [Julia specific commands](https://github.com/julia-vscode/julia-vscode/wiki/Commands)
* [integrated Julia REPL](https://github.com/julia-vscode/julia-vscode/wiki/REPL)
* [code completion](https://github.com/julia-vscode/julia-vscode/wiki/IntelliSense)
* [hover help](https://github.com/julia-vscode/julia-vscode/wiki/Information#hover-help)
* [a linter](https://github.com/julia-vscode/julia-vscode/wiki/Information#linter)
* [code navigation](https://github.com/julia-vscode/julia-vscode/wiki/Navigation)
* tasks for running tests, builds, benchmarks and build documentation
* a debugger
* a plot gallery
* a grid viewer for tabular data
* integrated support for Weave.jl

## Documentation

The [documentation](https://www.julia-vscode.org/docs/stable/)
has sections that describe the features of this extension (including
e.g. keyboard shortcuts). This repo also has legacy docs in the
[wiki](https://github.com/julia-vscode/julia-vscode/wiki).

## Questions, Feature requests and contributions

1. If you face any issues, please open an issue [here](https://github.com/julia-vscode/julia-vscode/issues).
2. For some known issues and their solutions, please visit the [known issues and workarounds](https://github.com/julia-vscode/julia-vscode/wiki/Known-issues-and-workarounds).
3. If there is already an issue opened related to yours, please leave an upvote/downvote on the issue.
4. Contributions are always welcome! Please see our [contributing guide](https://github.com/julia-vscode/julia-vscode/blob/main/CONTRIBUTING.md) for more details.
## Data/Telemetry

The Julia extension for Visual Studio Code collects usage data and sends it to the development team to help improve the extension. Read our [privacy policy](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more and how to disable any telemetry.
