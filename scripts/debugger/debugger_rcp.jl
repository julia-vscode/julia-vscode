function decode_msg(line::AbstractString)
    pos = our_findfirst(':', line)
    pos2 = our_findnext(':', line, pos+1)

    msg_id = line[1:pos-1]        
    msg_cmd = line[pos+1:pos2-1]
    msg_body_encoded = line[pos2+1:end]
    msg_body = String(Base64.base64decode(msg_body_encoded))
    return msg_id, msg_cmd, msg_body
end

function send_notification(conn, msg_cmd::AbstractString, msg_body::AbstractString="")
    encoded_msg_body = Base64.base64encode(msg_body)
    println(conn, msg_cmd, ":notification:", encoded_msg_body)
end


function send_response(conn, msg_id::AbstractString, msg_body::AbstractString)
    encoded_msg_body = Base64.base64encode(msg_body)
    println(conn, "RESPONSE:", msg_id, ':', encoded_msg_body)
end
