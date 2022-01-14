### A Pluto.jl notebook ###
# v0.17.5

using Markdown
using InteractiveUtils

# ╔═╡ 604ae406-e879-4d6e-855f-4e723ed86be5
using FlameGraphs, Profile, JSON

# ╔═╡ 5386a255-f75a-4248-8e86-70c2a01e7145
function profile_test(n)
    for i = 1:n
        A = randn(100, 100, 20)
        m = maximum(A)
        Am = mapslices(sum, A; dims = 2)
        B = A[:, :, 5]
        Bsort = mapslices(sort, B; dims = 1)
        b = rand(100)
        C = B .* b
    end
end

# ╔═╡ 0f787a06-9e1e-4446-960b-ab04bc7cfa14
function tojson(node, root = false)
    name = string(node.data.sf.file)

    Dict(
        :meta => Dict(
            :func => node.data.sf.func,
            :file => basename(name),
            :path => name,
            :line => node.data.sf.line,
            :count => root ? sum(length(c.data.span) for c in node) : length(node.data.span),
            :flags => node.data.status
        ),
        :children => sort!([tojson(c) for c in node], by = node -> node[:meta][:count], rev = true)
    )
end

# ╔═╡ f83c4524-6fa9-11ec-3e9a-153a6295cf06
begin 
	Profile.clear()
	@profile profile_test(1000)
	
	
	d = Dict()
	for thread in ["all"]
	    d[thread] = tojson(flamegraph())
	end
	data = JSON.json(d)
	
	HTML("""
	<div id="profiler-container" style="height: 400px; position: relative"></div>
    
	<script type="text/javascript">
class ProfileViewer {
  data;
  currentThread;
  threads = [];
  activeNode;

  container;

  canvas;
  canvasCtx;
  canvasHeight;
  canvasWidth;
  canvasHeightCSS;
  canvasWidthCSS;
  hoverCanvas;
  hoverCanvasCtx;
  filterContainer;
  filterInput;
  tooltipElement;
  tooltip;

  offsetX = 0;
  offsetY = 0;

  isWheeling = false;
  canWheelDown = true;
  scrollPosition = 0;

  resizeObserver;
  isResizing = false;

  scrollListener;
  isScrolling = false;

  isMouseMove = false;

  // XXX: DPI awareness
  scale = window.devicePixelRatio;
  borderWidth = 2;
  padding = 5;
  fontConfig = '10px sans-serif';
  fontColor = '#fff';

  boxHeight = 24;

  destroyed = false;

  constructor(element, data = null) {
      if (typeof element === 'string') {
          element = document.querySelector(element)
      }

      if (!element) {
          throw new Error('Invalid parent element specified.')
      }

      this.container = element

      this.insertDOM()
      this.getStyles()

      this.registerResizeObserver()
      this.registerScrollListener()

      if (data) {
          this.setData(data)
      }

      this.getOffset()
  }

  destroy() {
      this.destroyed = true

      this.resizeObserver.disconnect()
      if (this.scrollHandler) {
          document.removeEventListener('scroll', (ev) => this.scrollHandler(ev))
      }
      if (this.stylesheet) {
          document.head.removeChild(this.stylesheet)
      }

      while (this.container.firstChild) {
          this.container.removeChild(this.container.lastChild)
      }
  }

  setData(data) {
      if (this.destroyed) {
          console.error('This profile viewer is destroyed.')
          return
      }
      this.data = data
      const threads = Object.keys(this.data)
      threads.sort((a, b) => {
          if (a === 'all') {
              return -1
          }
          if (b === 'all') {
              return 1
          }
          if (a < b) {
              return -1
          }
          if (a > b) {
              return 1
          }
          return 0
      })

      this.threads = threads
      this.currentThread = this.threads[0]
      this.activeNode = this.data[this.currentThread]

      this.updateFilter()
      this.redraw()
  }

  getStyles() {
      const style = window.getComputedStyle(this.container, null)
      const fontFamily = style.fontFamily
      const fontSize = style.fontSize

      this.fontConfig = parseInt(fontSize ?? '12px', 10)*this.scale + 'px ' + (fontFamily ?? 'sans-serif')
      this.borderColor = style.color ?? '#000'

      this.canvasCtx.font = this.fontConfig
      this.canvasCtx.textBaseline = 'middle'

      const textMetrics = this.canvasCtx.measureText(
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz'
      )
      this.boxHeight = Math.max(
          20,
          Math.ceil(
              ((textMetrics.fontBoundingBoxDescent ??
          textMetrics.actualBoundingBoxDescent) +
          (textMetrics.fontBoundingBoxAscent ??
            textMetrics.actualBoundingBoxAscent) +
          2 * this.padding)*this.scale
          )
      )
      if (this.activeNode) {
          this.redraw()
      }
  }

  redraw() {
      this.canWheelDown = false
      this.canvasCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight)
      this.clearHover()
      this.drawGraph(
          this.activeNode,
          this.canvasWidth,
          this.canvasHeight,
          0,
          this.scrollPosition
      )
  }

  insertDOM() {
      this.insertStylesheet()

      this.canvas = document.createElement('canvas')
      this.canvas.classList.add('__profiler-canvas')
      this.canvasCtx = this.canvas.getContext('2d')
      this.hoverCanvas = document.createElement('canvas')
      this.hoverCanvas.classList.add('__profiler-hover-canvas')
      this.hoverCanvasCtx = this.hoverCanvas.getContext('2d')

      this.container.appendChild(this.createFilterContainer())
      this.container.appendChild(this.canvas)
      this.container.appendChild(this.hoverCanvas)
      this.container.appendChild(this.createTooltip())

      this.canvas.addEventListener('wheel', (ev) => {
          if (!this.activeNode) {
              return
          }
          if (ev.deltaY > 0 && !this.canWheelDown) {
              return
          }
          if (ev.deltaY < 0 && this.scrollPosition === 0) {
              return
          }

          ev.preventDefault()
          ev.stopPropagation()
          if (!this.isWheeling) {
              window.requestAnimationFrame(() => {
                  this.scrollPosition = Math.min(0, this.scrollPosition - ev.deltaY)
                  this.redraw()
                  this.isWheeling = false
              })
              this.isWheeling = true
          }
      })

      this.canvas.addEventListener('mousemove', (ev) => {
          if (!this.isMouseMove && this.activeNode) {
              window.requestAnimationFrame(() => {
                  // XXX: this is bad
                  this.getOffset()

                  const mouseX = ev.clientX - this.offsetX
                  const mouseY = ev.clientY - this.offsetY

                  this.hoverCanvasCtx.clearRect(
                      0,
                      0,
                      this.canvasWidth,
                      this.canvasHeight
                  )

                  const didDraw = this.drawHover(
                      this.activeNode,
                      this.scale * mouseX,
                      this.scale * mouseY
                  )

                  if (didDraw) {
                      if (mouseX > this.canvasWidthCSS / 2) {
                          this.tooltipElement.style.right =
                this.canvasWidthCSS - mouseX + 10 + 'px'
                          this.tooltipElement.style.left = 'unset'
                      } else {
                          this.tooltipElement.style.right = 'unset'
                          this.tooltipElement.style.left = mouseX + 10 + 'px'
                      }
                      if (mouseY > this.canvasHeightCSS / 2) {
                          this.tooltipElement.style.bottom =
                this.canvasHeightCSS - mouseY + 10 + 'px'

                          this.tooltipElement.style.top = 'unset'
                      } else {
                          this.tooltipElement.style.bottom = 'unset'
                          this.tooltipElement.style.top = mouseY + 40 + 'px'
                      }
                      this.tooltipElement.style.display = 'block'
                  } else {
                      this.tooltipElement.style.display = 'none'
                  }
                  this.isMouseMove = false
              })
              this.isMouseMove = true
          }
      })

      this.canvas.addEventListener('click', (ev) => {
          if (!this.activeNode) {
              return
          }
          this.getOffset()

          const mouseX = this.scale * (ev.clientX - this.offsetX)
          const mouseY = this.scale * (ev.clientY - this.offsetY)

          if (ev.ctrlKey) {
              this.runOnNodeAtMousePosition(
                  this.activeNode,
                  mouseX,
                  mouseY,
                  (node) => {
                      if (this.ctrlClickHandler) {
                          this.ctrlClickHandler(node)
                      }
                  }
              )
          } else {
              if (this.zoomInOnNode(this.activeNode, mouseX, mouseY)) {
                  this.scrollPosition = 0
                  this.redraw()
              } else {
                  this.resetView()
              }
          }
      })
  }

  resetView() {
      this.activeNode = this.data[this.currentThread]
      this.scrollPosition = 0
      this.redraw()
  }

  insertStylesheet() {
      if (!document.querySelector('#__profiler_stylesheet')) {
          this.stylesheet = document.createElement('style')
          this.stylesheet.setAttribute('id', '__profiler-stylesheet')
          this.stylesheet.innerText = `
          .__profiler-canvas {
            z-index: 0;
            position: absolute;
            width: 100%;
          }
          .__profiler-hover-canvas {
            z-index: 1;
            position: absolute;
            pointer-events: none;
            width: 100%;
          }
          .__profiler-tooltip {
            z-index: 2;
            display: none;
            position: absolute;
            background-color: #ddd;
            border: 1px solid black;
            padding: 5px 10px;
            pointer-events: none;
            max-width: 45%;
            overflow: hidden;
          }
          .__profiler-tooltip > div {
            line-break: anywhere;
          }
          .__profiler-tooltip .fname {
              margin-left: 0.5em;
          }
          .__profiler-filter {
            height: 30px;
            padding: 2px 16px;
            margin: 0;
            box-sizing: border-box;
            border-bottom: 1px solid #444;
          }
          .__profiler-reset {
            float: right;
          }
        `

          document.head.appendChild(this.stylesheet)
      }
  }

  createTooltip() {
      this.tooltipElement = document.createElement('div')
      this.tooltipElement.classList.add('__profiler-tooltip')

      this.tooltip = {}

      this.tooltip.count = document.createElement('span')
      this.tooltip.percentage = document.createElement('span')
      this.tooltip.function = document.createElement('code')
      this.tooltip.function.classList.add('fname')
      this.tooltip.file = document.createElement('a')
      this.tooltip.flags = document.createElement('span')

      const rows = [
          [
              this.tooltip.count,
              document.createTextNode(' ('),
              this.tooltip.percentage,
              document.createTextNode('%) '),
              this.tooltip.function,
          ],
          [this.tooltip.file],
          [this.tooltip.flags],
      ]

      for (const row of rows) {
          const rowContainer = document.createElement('div')
          for (const col of row) {
              rowContainer.appendChild(col)
          }
          this.tooltipElement.appendChild(rowContainer)
      }

      this.tooltip['ctrlClickHint'] = document.createElement('small')

      this.tooltipElement.appendChild(this.tooltip['ctrlClickHint'])

      this.container.appendChild(this.tooltipElement)

      return this.tooltipElement
  }

  createFilterContainer() {
      this.filterContainer = document.createElement('div')
      this.filterContainer.classList.add('__profiler-filter')

      const info = document.createElement('label')
      info.innerText = 'Thread: '
      this.filterContainer.appendChild(info)

      this.filterInput = document.createElement('select')

      this.filterInput.addEventListener('change', (ev) => {
          this.currentThread = ev.target.value
          this.resetView()
      })

      this.filterContainer.appendChild(this.filterInput)

      const resetter = document.createElement('button')
      resetter.classList.add('__profiler-reset')
      resetter.innerText = 'reset view'
      resetter.addEventListener('click', (ev) => {
          this.resetView()
      })

      this.filterContainer.appendChild(resetter)

      return this.filterContainer
  }

  updateFilter() {
      while (this.filterInput.firstChild) {
          this.filterInput.removeChild(this.filterInput.lastChild)
      }

      for (const thread of this.threads) {
          const entry = document.createElement('option')
          entry.innerText = thread
          entry.setAttribute('value', thread)
          this.filterInput.appendChild(entry)
      }
  }

  registerResizeObserver() {
      this.resizeObserver = new ResizeObserver((entries) => {
          if (!this.isResizing) {
              for (const entry of entries) {
                  if (entry.target === this.container) {
                      window.requestAnimationFrame(() => {
                          if (window.devicePixelRatio !== this.scale) {
                              this.scale = window.devicePixelRatio
                              this.getStyles()
                          }
                          this.canvasWidth = Math.round(
                              entry.contentRect.width * this.scale
                          )
                          this.canvasHeight = Math.round(
                              (entry.contentRect.height - 30) * this.scale
                          )

                          this.canvasWidthCSS = entry.contentRect.width
                          this.canvasHeightCSS = entry.contentRect.height

                          this.canvas.width = this.canvasWidth
                          this.canvas.height = this.canvasHeight
                          this.hoverCanvas.width = this.canvasWidth
                          this.hoverCanvas.height = this.canvasHeight

                          this.redraw()
                          this.isResizing = false
                      })
                  }
              }
              this.isResizing = true
          }
      })

      this.resizeObserver.observe(this.container)
  }

  scrollHandler(e) {
      if (!this.isScrolling) {
          window.requestAnimationFrame(() => {
              this.getOffset()
              this.isScrolling = false
          })

          this.isScrolling = true
      }
  }

  getOffset() {
      const box = this.canvas.getBoundingClientRect()
      this.offsetX = box.left
      this.offsetY = box.top
  }

  registerScrollListener() {
      this.scrollListener = document.addEventListener('scroll', (ev) =>
          this.scrollHandler(ev)
      )
  }

  // hash of function named, used to seed PRNG
  nodeHash(node) {
      const hashString = node.meta.file + node.meta.line
      let hash = 0
      for (let i = 0; i < hashString.length; i++) {
          const char = hashString.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash
      }

      return hash
  }

  // Simple PRNG from https://stackoverflow.com/a/47593316/12113178
  mulberry32(a) {
      return function () {
          let t = (a += 0x6d2b79f5)
          t = Math.imul(t ^ (t >>> 15), t | 1)
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
  }

  // modifies the normal color by three stable random values drawn from a
  // PRNG seeded by the node hash
  modifyNodeColorByHash(r, g, b, hash, range = 70) {
      const rng = this.mulberry32(hash)

      r = Math.min(255, Math.max(0, r + (rng() - 0.5) * range)).toFixed()
      g = Math.min(255, Math.max(0, g + (rng() - 0.5) * range)).toFixed()
      b = Math.min(255, Math.max(0, b + (rng() - 0.5) * range)).toFixed()
      return { r, g, b }
  }

  nodeColors(node, hash) {
      let r, g, b
      let a = 1
      if (node.meta.flags & 0x01) {
          ({ r, g, b } = this.modifyNodeColorByHash(204, 103, 103, hash, 20))
      } else if (node.meta.flags & 0x08) {
          ({ r, g, b } = this.modifyNodeColorByHash(204, 53, 53, hash, 20))
      } else if (node.meta.flags & 0x02) {
          ({ r, g, b } = this.modifyNodeColorByHash(204, 153, 68, hash, 20))
      } else {
          ({ r, g, b } = this.modifyNodeColorByHash(64, 99, 221, hash))
      }
      if (node.meta.flags & 0x10) {
          a = 0.3
      }
      return {
          fill: 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')',
          stroke: 'rgba(' + 0.8 * r + ',' + 0.8 * g + ',' + 0.8 * b + ',' + a + ')',
      }
  }

  drawGraph(node, width, height, x, y) {
      if (!node) {
          return
      }
      this.canvasCtx.font = this.fontConfig
      this.canvasCtx.textBaseline = 'middle'

      if (y + this.boxHeight >= 0) {
          const hash = this.nodeHash(node)
          const { fill, stroke } = this.nodeColors(node, hash)

          this.drawNode(node.meta.func, fill, stroke, width, x, y)
      }
      node.pos = {
          x,
          y,
          width,
          height: this.boxHeight,
      }

      if (y + this.boxHeight <= this.canvasHeight) {
          for (const child of node.children) {
              const w = width * (child.meta.count / node.meta.count)
              this.drawGraph(child, w, height, x, y + this.boxHeight)
              x += w
          }
      } else {
          this.canWheelDown = true
      }
  }

  drawNode(text, color, bColor, width, x, y) {
      if (width < 1) {
          width = 1
      }
      const drawBorder = false //width > 20*this.borderWidth;
      this.canvasCtx.fillStyle = color
      this.canvasCtx.beginPath()
      this.canvasCtx.rect(
          x,
          y + this.borderWidth,
          width,
          this.boxHeight - this.borderWidth
      )
      this.canvasCtx.closePath()
      this.canvasCtx.fill()

      if (drawBorder) {
          this.canvasCtx.fillStyle = bColor
          this.canvasCtx.beginPath()
          this.canvasCtx.rect(
              x,
              y + this.borderWidth,
              this.borderWidth,
              this.boxHeight - this.borderWidth
          )
          this.canvasCtx.closePath()
          this.canvasCtx.fill()
      }

      const textWidth = width - 2 * this.padding

      if (textWidth > 10) {
          this.canvasCtx.save()
          this.canvasCtx.beginPath()
          this.canvasCtx.rect(
              x + this.padding,
              y + this.borderWidth + this.padding,
              textWidth,
              this.boxHeight - this.borderWidth - 2 * this.padding
          )
          this.canvasCtx.closePath()
          this.canvasCtx.clip()
          this.canvasCtx.fillStyle = '#fff'
          this.canvasCtx.fillText(text, x + this.padding, y + this.boxHeight / 2)
          this.canvasCtx.restore()
      }
  }

  updateTooltip(node) {
      this.tooltip.function.innerText = node.meta.func
      this.tooltip.file.innerText = node.meta.file + ':' + node.meta.line
      this.tooltip.count.innerText = node.meta.count
      this.tooltip.percentage.innerText = (100*node.meta.count/this.activeNode.meta.count).toFixed()

      let flags = ''

      if (node.meta.flags & 0x01) {
          flags += 'GC'
      }
      if (node.meta.flags & 0x02) {
          flags += ' dispatch'
      }
      if (node.meta.flags & 0x08) {
          flags += ' compilation'
      }
      if (node.meta.flags & 0x10) {
          flags += ' task'
      }
      if (flags !== '') {
          flags = 'Flags: ' + flags
      }
      this.tooltip.flags.innerText = flags

      if (this.ctrlClickHandler) {
          this.tooltip['ctrlClickHint'].innerText = 'Ctrl+Click to open this file'
      }
  }

  drawHoverNode(node) {
      this.hoverCanvasCtx.fillStyle = this.borderColor
      this.hoverCanvasCtx.fillRect(
          node.pos.x,
          node.pos.y + this.borderWidth,
          Math.max(1, node.pos.width),
          node.pos.height - this.borderWidth
      )
      const innerWidth = node.pos.width - this.borderWidth * 2
      if (innerWidth > 1) {
          this.hoverCanvasCtx.clearRect(
              node.pos.x + this.borderWidth,
              node.pos.y + 2 * this.borderWidth,
              innerWidth,
              node.pos.height - this.borderWidth * 3
          )
      }

      this.updateTooltip(node)
  }

  clearHover() {
      this.hoverCanvasCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight)
      this.tooltipElement.style.display = 'none'
  }

  drawHover(node, mouseX, mouseY) {
      let found = false
      this.runOnNodeAtMousePosition(node, mouseX, mouseY, (node) => {
          this.drawHoverNode(node)
          found = true
      })

      return found
  }

  runOnNodeAtMousePosition(root, x, y, f) {
      if (
          x >= Math.floor(root.pos.x) &&
      x <= Math.ceil(root.pos.x + root.pos.width) &&
      y >= root.pos.y
      ) {
          if (y <= root.pos.y + root.pos.height) {
              f(root)
              return true
          } else {
              for (const child of root.children) {
                  if (this.runOnNodeAtMousePosition(child, x, y, f)) {
                      return true
                  }
              }
          }
      }
      return false
  }

  zoomInOnNode(node, mouseX, mouseY) {
      let found = false
      this.runOnNodeAtMousePosition(node, mouseX, mouseY, (node) => {
          this.clearHover()
          this.activeNode = node
          found = true
      })

      return found
  }

  registerCtrlClickHandler(f) {
      this.ctrlClickHandler = f
  }
}


	  const prof = new ProfileViewer("#profiler-container")
      prof.setData($(data))
	</script>
	""")
end

# ╔═╡ 00000000-0000-0000-0000-000000000001
PLUTO_PROJECT_TOML_CONTENTS = """
[deps]
FlameGraphs = "08572546-2f56-4bcf-ba4e-bab62c3a3f89"
JSON = "682c06a0-de6a-54ab-a142-c8b1cf79cde6"

[compat]
FlameGraphs = "~0.2.8"
JSON = "~0.21.2"
"""

# ╔═╡ 00000000-0000-0000-0000-000000000002
PLUTO_MANIFEST_TOML_CONTENTS = """
# This file is machine-generated - editing it directly is not advised

julia_version = "1.8.0-DEV.1208"
manifest_format = "2.0"
project_hash = "a63b3802a2e928bee5d5fd2c58e7e4cda7884b73"

[[deps.AbstractTrees]]
git-tree-sha1 = "03e0550477d86222521d254b741d470ba17ea0b5"
uuid = "1520ce14-60c1-5f80-bbc7-55ef81b5835c"
version = "0.3.4"

[[deps.ArgTools]]
uuid = "0dad84c5-d112-42e6-8d28-ef12dabb789f"
version = "1.1.1"

[[deps.Artifacts]]
uuid = "56f22d72-fd6d-98f1-02f0-08ddc0907c33"

[[deps.Base64]]
uuid = "2a0f44e3-6c83-55bd-87e4-b1978d98bd5f"

[[deps.ColorTypes]]
deps = ["FixedPointNumbers", "Random"]
git-tree-sha1 = "024fe24d83e4a5bf5fc80501a314ce0d1aa35597"
uuid = "3da002f7-5984-5a60-b8a6-cbb66c0b333f"
version = "0.11.0"

[[deps.Colors]]
deps = ["ColorTypes", "FixedPointNumbers", "Reexport"]
git-tree-sha1 = "417b0ed7b8b838aa6ca0a87aadf1bb9eb111ce40"
uuid = "5ae59095-9a9b-59fe-a467-6f913c188581"
version = "0.12.8"

[[deps.CompilerSupportLibraries_jll]]
deps = ["Artifacts", "Libdl"]
uuid = "e66e0078-7015-5450-92f7-15fbd957f2ae"
version = "0.5.0+0"

[[deps.Dates]]
deps = ["Printf"]
uuid = "ade2ca70-3891-5945-98fb-dc099432e06a"

[[deps.Downloads]]
deps = ["ArgTools", "FileWatching", "LibCURL", "NetworkOptions"]
uuid = "f43a241f-c20a-4ad4-852c-f6b1247861c6"
version = "1.6.0"

[[deps.FileIO]]
deps = ["Pkg", "Requires", "UUIDs"]
git-tree-sha1 = "67551df041955cc6ee2ed098718c8fcd7fc7aebe"
uuid = "5789e2e9-d7fb-5bc7-8068-2c6fae9b9549"
version = "1.12.0"

[[deps.FileWatching]]
uuid = "7b1f6079-737a-58dc-b8bc-7a2ca5c1b5ee"

[[deps.FixedPointNumbers]]
deps = ["Statistics"]
git-tree-sha1 = "335bfdceacc84c5cdf16aadc768aa5ddfc5383cc"
uuid = "53c48c17-4a7d-5ca2-90c5-79b7896eea93"
version = "0.8.4"

[[deps.FlameGraphs]]
deps = ["AbstractTrees", "Colors", "FileIO", "FixedPointNumbers", "IndirectArrays", "LeftChildRightSiblingTrees", "Profile"]
git-tree-sha1 = "358df0acb0526b2201c35d96f5cc6fca85c27fbe"
uuid = "08572546-2f56-4bcf-ba4e-bab62c3a3f89"
version = "0.2.8"

[[deps.IndirectArrays]]
git-tree-sha1 = "012e604e1c7458645cb8b436f8fba789a51b257f"
uuid = "9b13fd28-a010-5f03-acff-a1bbcff69959"
version = "1.0.0"

[[deps.InteractiveUtils]]
deps = ["Markdown"]
uuid = "b77e0a4c-d291-57a0-90e8-8db25a27a240"

[[deps.JSON]]
deps = ["Dates", "Mmap", "Parsers", "Unicode"]
git-tree-sha1 = "8076680b162ada2a031f707ac7b4953e30667a37"
uuid = "682c06a0-de6a-54ab-a142-c8b1cf79cde6"
version = "0.21.2"

[[deps.LeftChildRightSiblingTrees]]
deps = ["AbstractTrees"]
git-tree-sha1 = "b864cb409e8e445688bc478ef87c0afe4f6d1f8d"
uuid = "1d6d02ad-be62-4b6b-8a6d-2f90e265016e"
version = "0.1.3"

[[deps.LibCURL]]
deps = ["LibCURL_jll", "MozillaCACerts_jll"]
uuid = "b27032c2-a3e7-50c8-80cd-2d36dbcbfd21"
version = "0.6.3"

[[deps.LibCURL_jll]]
deps = ["Artifacts", "LibSSH2_jll", "Libdl", "MbedTLS_jll", "Zlib_jll", "nghttp2_jll"]
uuid = "deac9b47-8bc7-5906-a0fe-35ac56dc84c0"
version = "7.73.0+4"

[[deps.LibGit2]]
deps = ["Base64", "NetworkOptions", "Printf", "SHA"]
uuid = "76f85450-5226-5b5a-8eaa-529ad045b433"

[[deps.LibSSH2_jll]]
deps = ["Artifacts", "Libdl", "MbedTLS_jll"]
uuid = "29816b5a-b9ab-546f-933c-edad1886dfa8"
version = "1.9.1+2"

[[deps.Libdl]]
uuid = "8f399da3-3557-5675-b5ff-fb832c97cbdb"

[[deps.LinearAlgebra]]
deps = ["Libdl", "libblastrampoline_jll"]
uuid = "37e2e46d-f89d-539d-b4ee-838fcccc9c8e"

[[deps.Logging]]
uuid = "56ddb016-857b-54e1-b83d-db4d58db5568"

[[deps.Markdown]]
deps = ["Base64"]
uuid = "d6f4376e-aef5-505a-96c1-9c027394607a"

[[deps.MbedTLS_jll]]
deps = ["Artifacts", "Libdl"]
uuid = "c8ffd9c3-330d-5841-b78e-0817d7145fa1"
version = "2.24.0+2"

[[deps.Mmap]]
uuid = "a63ad114-7e13-5084-954f-fe012c677804"

[[deps.MozillaCACerts_jll]]
uuid = "14a3606d-f60d-562e-9121-12d972cd8159"
version = "2020.7.22"

[[deps.NetworkOptions]]
uuid = "ca575930-c2e3-43a9-ace4-1e988b2c1908"
version = "1.2.0"

[[deps.OpenBLAS_jll]]
deps = ["Artifacts", "CompilerSupportLibraries_jll", "Libdl"]
uuid = "4536629a-c528-5b80-bd46-f80d51c5b363"
version = "0.3.17+2"

[[deps.Parsers]]
deps = ["Dates"]
git-tree-sha1 = "d7fa6237da8004be601e19bd6666083056649918"
uuid = "69de0a69-1ddd-5017-9359-2bf0b02dc9f0"
version = "2.1.3"

[[deps.Pkg]]
deps = ["Artifacts", "Dates", "Downloads", "LibGit2", "Libdl", "Logging", "Markdown", "Printf", "REPL", "Random", "SHA", "Serialization", "TOML", "Tar", "UUIDs", "p7zip_jll"]
uuid = "44cfe95a-1eb2-52ea-b672-e2afdf69b78f"
version = "1.8.0"

[[deps.Printf]]
deps = ["Unicode"]
uuid = "de0858da-6303-5e67-8744-51eddeeeb8d7"

[[deps.Profile]]
deps = ["Printf"]
uuid = "9abbd945-dff8-562f-b5e8-e1ebf5ef1b79"

[[deps.REPL]]
deps = ["InteractiveUtils", "Markdown", "Sockets", "Unicode"]
uuid = "3fa0cd96-eef1-5676-8a61-b3b8758bbffb"

[[deps.Random]]
deps = ["SHA", "Serialization"]
uuid = "9a3f8284-a2c9-5f02-9a11-845980a1fd5c"

[[deps.Reexport]]
git-tree-sha1 = "45e428421666073eab6f2da5c9d310d99bb12f9b"
uuid = "189a3867-3050-52da-a836-e630ba90ab69"
version = "1.2.2"

[[deps.Requires]]
deps = ["UUIDs"]
git-tree-sha1 = "8f82019e525f4d5c669692772a6f4b0a58b06a6a"
uuid = "ae029012-a4dd-5104-9daa-d747884805df"
version = "1.2.0"

[[deps.SHA]]
uuid = "ea8e919c-243c-51af-8825-aaa63cd721ce"
version = "0.7.0"

[[deps.Serialization]]
uuid = "9e88b42a-f829-5b0c-bbe9-9e923198166b"

[[deps.Sockets]]
uuid = "6462fe0b-24de-5631-8697-dd941f90decc"

[[deps.SparseArrays]]
deps = ["LinearAlgebra", "Random"]
uuid = "2f01184e-e22b-5df5-ae63-d93ebab69eaf"

[[deps.Statistics]]
deps = ["LinearAlgebra", "SparseArrays"]
uuid = "10745b16-79ce-11e8-11f9-7d13ad32a3b2"

[[deps.TOML]]
deps = ["Dates"]
uuid = "fa267f1f-6049-4f14-aa54-33bafae1ed76"
version = "1.0.0"

[[deps.Tar]]
deps = ["ArgTools", "SHA"]
uuid = "a4e569a6-e804-4fa4-b0f3-eef7a1d5b13e"
version = "1.10.0"

[[deps.UUIDs]]
deps = ["Random", "SHA"]
uuid = "cf7118a7-6976-5b1a-9a39-7adc72f591a4"

[[deps.Unicode]]
uuid = "4ec0a83e-493e-50e2-b9ac-8f72acf5a8f5"

[[deps.Zlib_jll]]
deps = ["Libdl"]
uuid = "83775a58-1f1d-513f-b197-d71354ab007a"
version = "1.2.12+1"

[[deps.libblastrampoline_jll]]
deps = ["Artifacts", "Libdl", "OpenBLAS_jll"]
uuid = "8e850b90-86db-534c-a0d3-1478176c7d93"
version = "3.1.0+0"

[[deps.nghttp2_jll]]
deps = ["Artifacts", "Libdl"]
uuid = "8e850ede-7688-5339-a07c-302acd2aaf8d"
version = "1.41.0+1"

[[deps.p7zip_jll]]
deps = ["Artifacts", "Libdl"]
uuid = "3f19e933-33d8-53b3-aaab-bd5110c3b7a0"
version = "16.2.1+1"
"""

# ╔═╡ Cell order:
# ╟─f83c4524-6fa9-11ec-3e9a-153a6295cf06
# ╠═604ae406-e879-4d6e-855f-4e723ed86be5
# ╟─5386a255-f75a-4248-8e86-70c2a01e7145
# ╟─0f787a06-9e1e-4446-960b-ab04bc7cfa14
# ╟─00000000-0000-0000-0000-000000000001
# ╟─00000000-0000-0000-0000-000000000002
