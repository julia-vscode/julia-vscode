# TODO: move this into the future packaged `terminalserver.jl`'s build step

using Documenter
using Documenter.Writers.HTMLWriter.RD

download_uri(uri) = download(uri, basename(uri))

# dependency stylesheets/script
download(RD.google_fonts, "google_fonts")
download_uri.(RD.fontawesome_css)
download_uri(RD.katex_css)
download_uri(RD.requirejs_cdn)

# documenter.js
# NOTE: don't remember comment out the search.js, themeswap.js parts
makedocs(root = "sandbox/", sitename = "mock_doc")
cp("sandbox/build/assets/documenter.js", "documenter.js", force = true)

# Documenter stylesheets
download("https://raw.githubusercontent.com/JuliaDocs/Documenter.jl/master/assets/html/themes/documenter-light.css", "./documenter-light.css")
download("https://raw.githubusercontent.com/JuliaDocs/Documenter.jl/master/assets/html/themes/documenter-dark.css", "./documenter-dark.css")
