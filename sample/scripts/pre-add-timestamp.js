// Pre-request script: adds an X-Request-Timestamp header to every request.
// Demonstrates mutating request headers before the HTTP call is made.
request.headers['X-Request-Timestamp'] = new Date().toISOString();
console.log('Timestamp header added:', request.headers['X-Request-Timestamp']);
