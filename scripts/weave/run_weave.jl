stderr_copy = stderr

rserr, wrerr = redirect_stderr()

using Weave
# For some reason this is needed on Windows, without it we see lots of errors
@info "Ignore"

redirect_stderr(stderr_copy)
close(rserr)
close(wrerr)

input_file = readline()
output_file = readline()
doctype = readline()

if doctype == "PREVIEW"
    template_path = joinpath(dirname(@__FILE__), "preview.tpl")

    Weave.weave(input_file, out_path = output_file, template = template_path)
else
    cd(dirname(input_file))
    Weave.weave(input_file, out_path = :doc, doctype = doctype)
end
