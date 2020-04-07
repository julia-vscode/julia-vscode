function _parse_julia_file(filename::String)
    return Base.parse_input_line(read(filename, String); filename=filename)
end

function lowercase_drive(a)
    if length(a) >= 2 && a[2]==':'
        return lowercase(a[1]) * a[2:end]
    else
        return a
    end
end
