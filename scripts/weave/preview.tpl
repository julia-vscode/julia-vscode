<!DOCTYPE html>
<HTML lang = "en">
<HEAD>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  {{#:title}}<title>{{:title}}</title>{{/:title}}
  {{{ :header_script }}}

  <script>
    document.addEventListener("DOMContentLoaded", function() {
      renderMathInElement(document.body,
          {
              delimiters: [
                  {left: "$$", right: "$$", display: true},
                  {left: "\\[", right: "\\]", display: true},
                  {left: "$", right: "$", display: false},
                  {left: "\\(", right: "\\)", display: false}
              ]
          });
    });
  </script>

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.9.0-beta/katex.min.css" integrity="sha384-L/SNYu0HM7XECWBeshTGLluQO9uVI1tvkCtunuoUbCHHoTH76cDyXty69Bb9I0qZ" crossorigin="anonymous">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.9.0-beta/katex.min.js" integrity="sha384-ad+n9lzhJjYgO67lARKETJH6WuQVDDlRfj81AJJSswMyMkXTD49wBj5EP004WOY6" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.9.0-beta/contrib/auto-render.min.js" integrity="sha384-EkJr57fExjeMKAZnlVBuoBoX0EJ4BiDPiAd/JyTzIA65ORu4hna7V6aaq4zsUvJ2" crossorigin="anonymous"></script>


  <style type="text/css">
  {{{ :themecss }}}
  </style>

  {{{ :highlightcss }}}

</HEAD>
  <BODY>
    <div class ="container" style="background-color: white">
      <div class = "row">
        <div class = "col-md-12 twelve columns">

          <div class="title">
            {{#:title}}<h1 class="title">{{:title}}</h1>{{/:title}}
            {{#:author}}<h5>{{{:author}}}</h5>{{/:author}}
            {{#:date}}<h5>{{{:date}}}</h5>{{/:date}}
          </div>

          {{{ :body }}}


          <HR/>
          <div class="footer"><p>
          Published using
          <a href="http://github.com/mpastell/Weave.jl" target="_blank">Weave.jl</a>
          {{:wversion}} on {{:wtime}}.
          <p></div>


        </div>
      </div>
    </div>
  </BODY>
</HTML>
