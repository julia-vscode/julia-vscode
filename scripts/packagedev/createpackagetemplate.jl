using PkgTemplates

try
  pkg_name = ARGS[lastindex(ARGS)]
  # TODO: get template options from user
  # TODO: if no user from config don't include github
  Template(; user="TEMP")(pkg_name)
catch err
  Base.display_error(err, catch_backtrace())

end
