var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseHttpsRedirection();

app.MapGet("/api/hello", () => new { message = "Hello from local API!" });
app.MapGet("/api/health", () => new { status = "healthy", timestamp = DateTime.UtcNow });

app.Urls.Add("http://localhost:5000");
app.Urls.Add("https://localhost:5001");
app.Run();
