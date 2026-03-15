struct HOFEntry
    mod::Module
    name::Symbol
end
Base.isless(a::HOFEntry, b::HOFEntry) = isless((string(a.mod), a.name), (string(b.mod), b.name))
Base.:(==)(a::HOFEntry, b::HOFEntry) = a.mod === b.mod && a.name === b.name
Base.hash(a::HOFEntry, h::UInt) = hash(a.name, hash(objectid(a.mod), h))
Base.show(io::IO, e::HOFEntry) = print(io, e.mod, ".", e.name)
