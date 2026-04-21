import { strict as assert } from 'assert';
import {
	parseHttpFile,
	resolveRequest,
	extractReferencedVarNames,
	type ParsedFile,
	type ParsedRequest,
} from '../httpParser';

describe('httpParser', () => {
	describe('parseHttpFile', () => {
		it('parses a minimal GET request with no separators', () => {
			const result = parseHttpFile('GET https://api.example.com');
			assert.equal(result.variables.length, 0);
			assert.equal(result.requests.length, 1);
			assert.equal(result.requests[0].method, 'GET');
			assert.equal(result.requests[0].url, 'https://api.example.com');
		});

		it('derives name from method and url', () => {
			const result = parseHttpFile('GET https://api.example.com');
			assert.equal(result.requests[0].name, 'GET https://api.example.com');
		});

		it('truncates long method+url names to 57 chars + ellipsis when > 60', () => {
			const longUrl = 'https://api.example.com/very/long/path/that/exceeds/sixty/characters/total';
			const result = parseHttpFile(`GET ${longUrl}`);
			const name = result.requests[0].name;
			assert(name.endsWith('…'));
			assert.equal(name.length, 58); // 57 chars + 1 ellipsis
		});

		it('parses multiple requests separated by ###', () => {
			const text = `GET https://api1.example.com

###

POST https://api2.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests.length, 2);
			assert.equal(result.requests[0].method, 'GET');
			assert.equal(result.requests[1].method, 'POST');
		});

		it('uses ### label as request name if no @name annotation', () => {
			const text = `### Get Users
GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].name, 'Get Users');
		});

		it('@name annotation overrides ### label', () => {
			const text = `### Old Label
# @name New Name
GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].name, 'New Name');
		});

		it('parses @var = value file-level variables', () => {
			const text = `@baseUrl = https://api.example.com
@token = abc123

GET {{baseUrl}}/users`;
			const result = parseHttpFile(text);
			assert.equal(result.variables.length, 2);
			assert.equal(result.variables[0].name, 'baseUrl');
			assert.equal(result.variables[0].value, 'https://api.example.com');
			assert.equal(result.variables[0].line, 0);
			assert.equal(result.variables[1].name, 'token');
			assert.equal(result.variables[1].line, 1);
		});

		it('parses variables and requests from files with Windows CRLF line endings', () => {
			const text = '@baseUrl = https://api.example.com\r\n@token = abc\r\n\r\nGET {{baseUrl}}/users\r\n';
			const result = parseHttpFile(text);
			assert.equal(result.variables.length, 2);
			assert.equal(result.variables[0].name, 'baseUrl');
			assert.equal(result.variables[0].value, 'https://api.example.com');
			assert.equal(result.variables[1].name, 'token');
			assert.equal(result.variables[1].value, 'abc');
			assert.equal(result.requests.length, 1);
			assert.equal(result.requests[0].url, '{{baseUrl}}/users');
		});

		it('parses headers up to the first blank line', () => {
			const text = `GET https://api.example.com
Content-Type: application/json
Authorization: Bearer token123

{"key": "value"}`;
			const result = parseHttpFile(text);
			const req = result.requests[0];
			assert.equal(req.headers.length, 2);
			assert.equal(req.headers[0].name, 'Content-Type');
			assert.equal(req.headers[0].value, 'application/json');
			assert.equal(req.headers[1].name, 'Authorization');
			assert.equal(req.headers[1].value, 'Bearer token123');
		});

		it('parses body as everything after blank line', () => {
			const text = `POST https://api.example.com

{"name": "John", "age": 30}`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].body, '{"name": "John", "age": 30}');
		});

		it('multiline body is preserved', () => {
			const text = `POST https://api.example.com

{
  "name": "John",
  "age": 30
}`;
			const result = parseHttpFile(text);
			const body = result.requests[0].body!;
			assert(body.includes('"name": "John"'));
			assert(body.includes('"age": 30'));
		});

		it('returns undefined body if no blank line found', () => {
			const text = `GET https://api.example.com
Content-Type: application/json`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].body, undefined);
		});

		it('skips blocks without valid HTTP method line', () => {
			const text = `some random text
without a valid request

###

GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests.length, 1);
			assert.equal(result.requests[0].method, 'GET');
		});

		it('defaults httpVersion to HTTP/1.1 when omitted', () => {
			const text = `GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].httpVersion, 'HTTP/1.1');
		});

		it('parses explicit HTTP version from request line', () => {
			const text = `GET https://api.example.com HTTP/2`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].httpVersion, 'HTTP/2');
		});

		it('extracts description from comment lines before request line', () => {
			const text = `# This is a comment
# describing the request
GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].description, 'This is a comment\ndescribing the request');
		});

		it('skips empty comment lines in description', () => {
			const text = `# First line

# Second line
GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].description, 'First line\nSecond line');
		});

		it('skips @var declarations in description', () => {
			const text = `# Description
@someVar = value
GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].description, 'Description');
		});

		it('supports // style comments', () => {
			const text = `// This is a comment
GET https://api.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].description, 'This is a comment');
		});

		it('assigns index to each request in file order', () => {
			const text = `GET https://api1.example.com

###

GET https://api2.example.com

###

GET https://api3.example.com`;
			const result = parseHttpFile(text);
			assert.equal(result.requests[0].index, 0);
			assert.equal(result.requests[1].index, 1);
			assert.equal(result.requests[2].index, 2);
		});

		it('includes raw block content', () => {
			const text = `GET https://api.example.com
Content-Type: application/json`;
			const result = parseHttpFile(text);
			assert(result.requests[0].raw.includes('GET'));
			assert(result.requests[0].raw.includes('Content-Type'));
		});
	});

	describe('resolveRequest', () => {
		const baseRequest: ParsedRequest = {
			name: 'Test',
			method: 'POST',
			url: 'https://{{baseUrl}}/users',
			httpVersion: 'HTTP/1.1',
			headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
			body: '{"id": "{{userId}}"}',
			description: undefined,
			index: 0,
			raw: '',
		};

		it('substitutes file-level variables in url, headers, and body', () => {
			const fileVars = [
				{ name: 'baseUrl', value: 'api.example.com', line: 0 },
				{ name: 'token', value: 'abc123', line: 1 },
				{ name: 'userId', value: 'user-42', line: 2 },
			];
			const resolved = resolveRequest(baseRequest, fileVars);
			assert.equal(resolved.url, 'https://api.example.com/users');
			assert.equal(resolved.headers[0].value, 'Bearer abc123');
			assert.equal(resolved.body, '{"id": "user-42"}');
		});

		it('env variables have lower priority than file variables', () => {
			const fileVars = [{ name: 'baseUrl', value: 'file.example.com', line: 0 }];
			const envVars = [{ name: 'baseUrl', value: 'env.example.com' }];
			const resolved = resolveRequest(baseRequest, fileVars, envVars);
			assert.equal(resolved.url, 'https://file.example.com/users');
		});

		it('env variables are used when no file variable exists', () => {
			const envVars = [{ name: 'baseUrl', value: 'api.example.com' }];
			const resolved = resolveRequest(baseRequest, [], envVars);
			assert.equal(resolved.url, 'https://api.example.com/users');
		});

		it('inline block variables have highest priority', () => {
			const fileVars = [{ name: 'baseUrl', value: 'file.example.com', line: 0 }];
			const envVars = [{ name: 'baseUrl', value: 'env.example.com' }];
			const blockWithInline: ParsedRequest = {
				...baseRequest,
				raw: `@baseUrl = block.example.com
POST https://{{baseUrl}}/users`,
			};
			const resolved = resolveRequest(blockWithInline, fileVars, envVars);
			assert.equal(resolved.url, 'https://block.example.com/users');
		});

		it('leaves unknown {{vars}} unchanged', () => {
			const resolved = resolveRequest(baseRequest, []);
			assert(resolved.url.includes('{{baseUrl}}'));
			assert(resolved.headers[0].value.includes('{{token}}'));
			assert(resolved.body!.includes('{{userId}}'));
		});

		it('leaves body unchanged if undefined', () => {
			const reqNoBody: ParsedRequest = {
				...baseRequest,
				body: undefined,
			};
			const resolved = resolveRequest(reqNoBody, []);
			assert.equal(resolved.body, undefined);
		});

		it('substitutes in all headers', () => {
			const req: ParsedRequest = {
				...baseRequest,
				headers: [
					{ name: 'Authorization', value: 'Bearer {{token}}' },
					{ name: 'X-User-Id', value: '{{userId}}' },
				],
			};
			const fileVars = [
				{ name: 'token', value: 'secret', line: 0 },
				{ name: 'userId', value: '123', line: 1 },
			];
			const resolved = resolveRequest(req, fileVars);
			assert.equal(resolved.headers[0].value, 'Bearer secret');
			assert.equal(resolved.headers[1].value, '123');
		});
	});

	describe('extractReferencedVarNames', () => {
		it('extracts var names from url', () => {
			const req: ParsedRequest = {
				name: 'Test',
				method: 'GET',
				url: 'https://{{baseUrl}}/{{endpoint}}',
				httpVersion: 'HTTP/1.1',
				headers: [],
				body: undefined,
				description: undefined,
				index: 0,
				raw: '',
			};
			const names = extractReferencedVarNames(req);
			assert(names.includes('baseUrl'));
			assert(names.includes('endpoint'));
		});

		it('extracts var names from headers', () => {
			const req: ParsedRequest = {
				name: 'Test',
				method: 'GET',
				url: 'https://api.example.com',
				httpVersion: 'HTTP/1.1',
				headers: [
					{ name: 'Authorization', value: 'Bearer {{token}}' },
					{ name: 'X-Request-Id', value: '{{requestId}}' },
				],
				body: undefined,
				description: undefined,
				index: 0,
				raw: '',
			};
			const names = extractReferencedVarNames(req);
			assert(names.includes('token'));
			assert(names.includes('requestId'));
		});

		it('extracts var names from body', () => {
			const req: ParsedRequest = {
				name: 'Test',
				method: 'POST',
				url: 'https://api.example.com',
				httpVersion: 'HTTP/1.1',
				headers: [],
				body: '{"id": "{{userId}}", "org": "{{orgId}}"}',
				description: undefined,
				index: 0,
				raw: '',
			};
			const names = extractReferencedVarNames(req);
			assert(names.includes('userId'));
			assert(names.includes('orgId'));
		});

		it('deduplicates variable names', () => {
			const req: ParsedRequest = {
				name: 'Test',
				method: 'POST',
				url: 'https://{{baseUrl}}/users',
				httpVersion: 'HTTP/1.1',
				headers: [{ name: 'Host', value: '{{baseUrl}}' }],
				body: 'https://{{baseUrl}}/callback',
				description: undefined,
				index: 0,
				raw: '',
			};
			const names = extractReferencedVarNames(req);
			assert.equal(names.filter(n => n === 'baseUrl').length, 1);
		});

		it('returns empty array when no vars referenced', () => {
			const req: ParsedRequest = {
				name: 'Test',
				method: 'GET',
				url: 'https://api.example.com',
				httpVersion: 'HTTP/1.1',
				headers: [],
				body: undefined,
				description: undefined,
				index: 0,
				raw: '',
			};
			const names = extractReferencedVarNames(req);
			assert.equal(names.length, 0);
		});
	});
});
