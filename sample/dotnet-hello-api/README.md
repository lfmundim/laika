# Hello World .NET API Sample

A minimal .NET 10 API for testing Laika with local endpoints, including HTTPS redirect handling.

## Setup

1. Install [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
2. Trust the development HTTPS certificate:
   ```sh
   dotnet dev-certs https --trust
   ```
3. Run the API:
   ```sh
   dotnet run
   ```
   The API will start on both:
   - HTTP: `http://localhost:5000` (redirects to HTTPS)
   - HTTPS: `https://localhost:5001`

## Testing with Laika

1. Open VS Code in this directory (or its parent)
2. Open the `test.http` file
3. Use Laika to send requests to the HTTPS endpoint:
   - **Health check** — `GET https://localhost:5001/api/health` — verifies the server is running
   - **Hello endpoint** — `GET https://localhost:5001/api/hello` — returns a greeting message

> **Note:** The sample uses HTTPS with an auto-generated development certificate. Make sure to trust it (see Setup step 2) so that certificate validation doesn't fail.

## Endpoints

- `GET /api/health` — returns `{ "status": "healthy", "timestamp": "..." }`
- `GET /api/hello` — returns `{ "message": "Hello from local API!" }`

## Testing Issue #10 (307 Redirect)

This sample tests [Issue #10](https://github.com/lfmundim/laika/issues/10): "Status code 307 returned when calling local APIs via Laika in VS Code".

**How it demonstrates the fix:**
- The API has `app.UseHttpsRedirection()` middleware enabled
- HTTP requests to `localhost:5000` are redirected (307) to `https://localhost:5001`
- Laika's `redirect: 'follow'` option in fetch now properly follows the redirect
- After trusting the development certificate, HTTPS requests work seamlessly

**If you encounter fetch errors (e.g., "Failed to fetch https://localhost:5001"):**

The most common cause is an untrusted self-signed certificate. VS Code's fetch API uses the system certificate store, so you **must** trust the certificate:

1. **First, make sure you ran the trust command** (see Setup step 2):
   ```sh
   dotnet dev-certs https --trust
   ```
2. **After trusting, you may need to:**
   - Restart VS Code completely (not just the extension)
   - Or restart your computer (on macOS, the certificate may need time to propagate)
3. Check that the API is still running: `dotnet run`
4. Test in your browser: open `https://localhost:5001/api/health`
   - If your browser shows a certificate warning, the trust didn't work yet
5. Try Laika again. Laika shows detailed error messages with the URL and error details to help diagnose the issue

## Notes

- The API uses HTTPS with an auto-generated development certificate
- Both endpoints are configured to not require authentication
- HTTP requests automatically redirect to HTTPS (testing the redirect fix)
- In production, consider using certificates from a trusted CA instead of dev certificates
