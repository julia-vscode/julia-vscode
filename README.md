# julia

This [VS Code](https://code.visualstudio.com) extension provides support for the [julia programming language](http://julialang.org/).

## Getting started

Getting the julia extension for VS Code to work involves two steps: 1.
Install VS Code and 2. Install the julia extension.

### Installing VS Code

Just head over to the [VS Code](https://code.visualstudio.com/) homepage
and follow the installation instructions for your platform. At the end of
this step you should be able to start VS Code.

### Install the julia extension

First, start VS Code. Inside VS Code, go to the extensions view either by
executing the ``View: Show Extensions`` command (click View->Command Palette...)
or by clicking on the extension icon on the left side of the VS Code
window.

In the extensions view, simply search for the term ``julia`` in the marketplace
search box, then select the julia extension and click the install button.
You might have to restart VS Code after this step.

### Configure the julia extension

If you have installed julia into a standard location on Mac or Windows, or
if the julia binary is on your ``PATH``, the julia VS Code extension should
automatically find your julia installation and you should not need to
configure anything.

If the extension does not find your julia installation automatically, or
if you want to use a different julia installation than the default one,
you can set the ``julia.executablePath`` to point to the julia executable
that the extension should use. In that case the
extension will always use that version of julia. To edit your configuration
settings, execute the ``Preferences: Open User Settings`` command (you can
also access it via the menu ``File->Preferences->Settings``), and
then make sure your user settings include the ``julia.executablePath``
setting. The format of the string should follow your platform specific
conventions, and be aware that the backlash ``\`` is the escape character
in JSON, so you need to use ``\\`` as the path separator character on Windows.

## Features

The extension currently provides

* syntax highlighting
* snippets
* [latex snippets](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Snippets#latex)
* [julia specific commands](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Commands)
* [integrated julia REPL](https://github.com/JuliaEditorSupport/julia-vscode/wiki/REPL)
* [code completion](https://github.com/JuliaEditorSupport/julia-vscode/wiki/IntelliSense)
* [hover help](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Information#hover-help)
* [a linter](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Information#linter)
* [code navigation](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Navigation)
* tasks for running tests, builds, benchmarks and build documentation

## Documentation

The [documentation](https://github.com/JuliaEditorSupport/julia-vscode/wiki)
has sections that describe the features of this extension (including
e.g. keyboard shortcuts).

## Known issues and workarounds

Please visit the [known issues and workarounds](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Known-issues-and-workarounds)
for up-to-date information about known issues and solutions for those
problems.

## Data/Telemetry

The julia extension for Visual Studio Code collects usage data and sends it to the development team to help improve the extension. Read our [privacy policy](https://github.com/JuliaEditorSupport/julia-vscode/wiki/Privacy-Policy) to learn more and how to disable any telemetry.
