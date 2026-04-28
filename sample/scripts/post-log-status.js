// Post-request script: logs the response status and duration.
// Wired at the $shared level so it runs after every request in any environment.
console.log(`Response: ${response.status} ${response.statusText} (${response.duration}ms)`);
