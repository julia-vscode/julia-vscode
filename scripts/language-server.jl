server = listen(7458)
header = String[]
while true
  conn = accept(server)
  @async begin
    try
      while true
        header = String[]
        line = chomp(readline(conn))
        push!(header,line)
        while length(line)>0
            line = chomp(readline(conn))
            push!(header,line)
        end
        header_dict = Dict{String,String}()
        for h in header[1:end-1]
            h_parts = split(h, ":")
            header_dict[chomp(h_parts[1])] = chomp(h_parts[2])
        end

        message_length = parse(Int, header_dict["Content-Length"])

        message = read(conn,message_length)
        message_str = String(message)
        println(message_str)
      end
    catch err
      print("connection ended with error $err")
    end
  end
end
