var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.MapGet("/api/hello", () => new { message = "Hello from local API!" });
app.MapGet("/api/health", () => new { status = "healthy", timestamp = DateTime.UtcNow });

app.Run("http://localhost:5000");
