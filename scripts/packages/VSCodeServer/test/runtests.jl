using Test
using VSCodeServer

@testset "VSCodeServer" begin
    @testset "parse_mime_parameters" begin
        # Basic parameter parsing
        @testset "Basic parameters" begin
            @test VSCodeServer.parse_mime_parameters(";a=1") == Dict("a" => "1")
            @test VSCodeServer.parse_mime_parameters(";a=1;b=2") == Dict("a" => "1", "b" => "2")
            @test VSCodeServer.parse_mime_parameters(";foo=bar;baz=qux") == Dict("foo" => "bar", "baz" => "qux")
        end

        # Case insensitivity for parameter names
        @testset "Case insensitivity" begin
            @test VSCodeServer.parse_mime_parameters(";Id=value") == Dict("id" => "value")
            @test VSCodeServer.parse_mime_parameters(";ID=value") == Dict("id" => "value")
            @test VSCodeServer.parse_mime_parameters(";Title=test") == Dict("title" => "test")
        end

        # Whitespace handling (OWS)
        @testset "Whitespace handling" begin
            @test VSCodeServer.parse_mime_parameters("; a=1") == Dict("a" => "1")
            @test VSCodeServer.parse_mime_parameters(";a=1 ;b=2") == Dict("a" => "1", "b" => "2")
            @test VSCodeServer.parse_mime_parameters("; a=1 ; b=2 ") == Dict("a" => "1", "b" => "2")
            @test VSCodeServer.parse_mime_parameters(";\ta=1\t;\tb=2") == Dict("a" => "1", "b" => "2")
        end

        # Quoted strings
        @testset "Quoted strings" begin
            @test VSCodeServer.parse_mime_parameters(";title=\"hello world\"") == Dict("title" => "hello world")
            @test VSCodeServer.parse_mime_parameters(";a=\"1\";b=\"2\"") == Dict("a" => "1", "b" => "2")
            @test VSCodeServer.parse_mime_parameters(";title=\"\"") == Dict("title" => "")
        end

        # Quoted strings with semicolons
        @testset "Semicolons in quoted strings" begin
            @test VSCodeServer.parse_mime_parameters(";title=\"Report; Final\"") == Dict("title" => "Report; Final")
            @test VSCodeServer.parse_mime_parameters(";a=\"x;y;z\"") == Dict("a" => "x;y;z")
        end

        # Escape sequences in quoted strings
        @testset "Escape sequences" begin
            @test VSCodeServer.parse_mime_parameters(";title=\"a\\\"b\"") == Dict("title" => "a\"b")
            @test VSCodeServer.parse_mime_parameters(";title=\"a\\\\b\"") == Dict("title" => "a\\b")
            @test VSCodeServer.parse_mime_parameters(";title=\"\\\"quoted\\\"\"") == Dict("title" => "\"quoted\"")
            @test VSCodeServer.parse_mime_parameters(";path=\"C:\\\\Users\\\\file\"") == Dict("path" => "C:\\Users\\file")
        end

        # Token characters (all valid tchar)
        @testset "Token characters" begin
            @test VSCodeServer.parse_mime_parameters(";a-b=c-d") == Dict("a-b" => "c-d")
            @test VSCodeServer.parse_mime_parameters(";a_b=c_d") == Dict("a_b" => "c_d")
            @test VSCodeServer.parse_mime_parameters(";a.b=c.d") == Dict("a.b" => "c.d")
            @test VSCodeServer.parse_mime_parameters(";a+b=c+d") == Dict("a+b" => "c+d")
            @test VSCodeServer.parse_mime_parameters(";v1.0=1.0") == Dict("v1.0" => "1.0")
        end

        @testset "Unicode is allowed in quoted strings" begin
            # Non-ASCII UTF-8 characters in token
            @test VSCodeServer.parse_mime_parameters(";x=\"Résumé\"") == Dict("x" => "Résumé")
        end

        # Empty trailing parameter
        @testset "Empty trailing parameter" begin
            @test VSCodeServer.parse_mime_parameters(";a=1;") == Dict("a" => "1")
            @test VSCodeServer.parse_mime_parameters(";a=1; ") == Dict("a" => "1")
        end

        # Error cases
        @testset "Error cases" begin
            # Missing semicolon at start
            @test_throws ErrorException VSCodeServer.parse_mime_parameters("a=1")

            # Invalid parameter name (contains invalid characters)
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a b=1")
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";\"quoted\"=value")

            # Missing equals sign
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a")
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a;b=2")

            # Whitespace around equals (not allowed per spec)
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a =1")
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a= 1")

            # Missing value
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a=")

            # Unterminated quoted string
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";title=\"unterminated")

            # Unterminated escape sequence
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";title=\"test\\")

            # Invalid character after parameter
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";a=1 b=2")

            # Non-ASCII UTF-8 characters in parameter name
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";Résumé=abc")

            # Non-ASCII UTF-8 characters in parameter value in token form (unquoted)
            @test_throws ErrorException VSCodeServer.parse_mime_parameters(";abc=Résumé")
        end
    end

    @testset "extract_mime_id" begin
        # No parameters
        @testset "No parameters" begin
            mime_type, id, title = VSCodeServer.extract_mime_id(MIME("text/plain"))
            @test mime_type == "text/plain"
            @test ismissing(id)
            @test ismissing(title)
        end

        # With id parameter
        @testset "With id" begin
            mime_type, id, title = VSCodeServer.extract_mime_id(MIME("application/vnd.julia-vscode.custompane+html;id=my-pane"))
            @test mime_type == "application/vnd.julia-vscode.custompane+html"
            @test id == "my-pane"
            @test ismissing(title)
        end

        # With both id and title
        @testset "With id and title" begin
            mime_type, id, title = VSCodeServer.extract_mime_id(MIME("application/vnd.julia-vscode.custompane+html;id=pane1;title=MyTitle"))
            @test mime_type == "application/vnd.julia-vscode.custompane+html"
            @test id == "pane1"
            @test title == "MyTitle"
        end

        # With quoted title containing semicolons
        @testset "Complex title" begin
            mime_type, id, title = VSCodeServer.extract_mime_id(MIME("application/vnd.julia-vscode.custompane+html;id=report;title=\"Q4 Report; Final Version\""))
            @test mime_type == "application/vnd.julia-vscode.custompane+html"
            @test id == "report"
            @test title == "Q4 Report; Final Version"
        end

        # Other parameters ignored
        @testset "Other parameters ignored" begin
            mime_type, id, title = VSCodeServer.extract_mime_id(MIME("text/html;id=test;charset=utf-8;title=foo"))
            @test mime_type == "text/html"
            @test id == "test"
            @test title == "foo"
        end
    end
end
