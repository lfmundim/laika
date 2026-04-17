# Hello World .NET API Sample

A minimal .NET 8 API for testing Laika with local endpoints.

## Setup

1. Install [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
2. Run the API:
   ```sh
   dotnet run
   ```
   The API will start on `http://localhost:5000`

## Testing with Laika

1. Open VS Code in this directory (or its parent)
2. Open the `test.http` file
3. Use Laika to send requests to the endpoints:
   - **Health check** — `/api/health` — verifies the server is running
   - **Hello endpoint** — `/api/hello` — returns a greeting message

## Endpoints

- `GET /api/health` — returns `{ "status": "healthy", "timestamp": "..." }`
- `GET /api/hello` — returns `{ "message": "Hello from local API!" }`

## Testing Issue #10 (307 Redirect)

This sample was created specifically to test [Issue #10](https://github.com/lfmundim/laika/issues/10): "Status code 307 returned when calling local APIs via Laika in VS Code".

**Problem:** When calling a local .NET API with HTTPS redirect middleware enabled, the API responds with 307 (Temporary Redirect). This happens because:
- The API has `app.UseHttpsRedirection()` middleware
- Local HTTP requests (http://localhost:5000) are redirected to HTTPS (https://localhost:5000)
- The redirect fails due to certificate validation issues or is not properly followed

**Solution:** 
- This sample disables HTTPS redirection in development mode
- Laika now explicitly sets `redirect: 'follow'` in fetch options to handle redirects properly
- If you encounter 307s with your own API, ensure:
  1. Remove or disable HTTPS redirect middleware in development
  2. Or use HTTPS with valid certificates for local testing
  3. Or use a proxy that handles the redirect transparently

## Notes

- The API runs on HTTP (not HTTPS) to simplify local testing
- Both endpoints are configured to not require authentication
- This sample helps debug redirect issues (issue #10) by providing a real local API
- To use with HTTPS in production, re-enable `app.UseHttpsRedirection()` in Program.cs
