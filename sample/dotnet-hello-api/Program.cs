var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// Don't use HTTPS redirect for this sample API to avoid 307 responses on local HTTP calls
// If running in production, consider using app.UseHttpsRedirection() instead

app.MapGet("/api/hello", () => new { message = "Hello from local API!" });
app.MapGet("/api/health", () => new { status = "healthy", timestamp = DateTime.UtcNow });

app.Run("http://localhost:5000");
