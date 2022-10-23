## Developer Instructions

### Install extension from source

1. Install required dependencies, `node` and `npm`, and make sure they are available in `PATH`.

2. Clone the repository (including submodules):
   ```bash
   git clone --recurse-submodules https://github.com/julia-vscode/julia-vscode
   cd julia-vscode
   ```

   If you have already cloned the repository, update the submodules:
   ```bash
   git submodule update --init
   ```
   install deps
   ```bash
   npm i
   ```

3. Open the folder where the extension was cloned in VSCode. The `Start Debugging` command (<kbd>F5</kbd>) opens a separate window with the modified extension in debug mode

### Reload extension after making changes

To reload the Extension Development Host window after making changes, hit <kbd>ctrl/cmd + R</kbd>.

## License

By contributing code to julia-vscode, you are agreeing to release that code under the [MIT License](https://github.com/julia-vscode/julia-vscode/blob/main/LICENSE).
