var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    // Skip HTTPS redirect in development for local testing
}
else
{
    app.UseHttpsRedirection();
}

app.MapGet("/api/hello", () => new { message = "Hello from local API!" })
    .WithName("GetHello")
    .WithOpenApi();

app.MapGet("/api/health", () => new { status = "healthy", timestamp = DateTime.UtcNow })
    .WithName("HealthCheck")
    .WithOpenApi();

app.Run("http://localhost:5000");
