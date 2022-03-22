using PkgTemplates

try
  pkg_name = ARGS[1]
  dir = ARGS[2]
  authors = split(ARGS[3], ',')
  host = ARGS[4]
  user = ARGS[5]
  julia = VersionNumber(ARGS[6])
  plugins = ARGS[7:end] # TODO: Plugin Dict
  Template(;user=user, authors=authors, dir=dir, host=host, julia=julia)(pkg_name)
catch err
  Base.display_error(err, catch_backtrace())
end
