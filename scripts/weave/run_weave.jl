stderr_copy = Base.STDERR

rserr, wrerr = redirect_stderr()

using Weave
# For some reason this is needed on Windows, without it we see lots of errors
info("Ignore")

redirect_stderr(stderr_copy)
close(rserr)
close(wrerr)

input_file = readline()
input_file = chomp(input_file)

output_file = readline()
output_file = chomp(output_file)

doctype = readline()
doctype = chomp(doctype)

if doctype=="PREVIEW"
    template_path = joinpath(dirname(@__FILE__), "preview.tpl")

    Weave.weave(input_file, out_path=output_file, template=template_path)
else
    Weave.weave(input_file, out_path=:doc, doctype=doctype)
end
