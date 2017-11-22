# julia

This [VS Code](https://code.visualstudio.com) extension provides support for the [julia programming language](http://julialang.org/).

## Getting started

Getting the julia extension for VS Code to work involves three steps: 1.
Install VS Code, 2. Install the julia extension and 3. configure the
julia extension to find your local julia binary.

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

Once the extension is installed it needs to find the julia binary on your
system. There are two options: if your julia binary is on the path and
you have not configured something else, the extension will use that
version of julia. Alternatively, you can set the ``julia.executablePath``
configuration setting to point to a julia binary, in which case the
extension will always use that version of julia. To edit your configuration
settings, execute the ``File/Preferences: Open User Settings`` command, and
then make sure your user settings include the ``julia.executablePath``
setting. The format of the string should follow your platform specific
conventions, and be aware that the backlash ``\`` is the escape character
in JSON, so you need to use ``\\`` as the path separator character on Windows.

#### Note for MacOS Users
When setting your ``julia.executablePath``, you need to make sure that
you are linking to the correct executable within your ``julia-x.x.app``
folder. The correct executable is located at
```
[Path to applications folder]/Julia-x.x.app/Contents/Resources/julia/bin/julia
```

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
