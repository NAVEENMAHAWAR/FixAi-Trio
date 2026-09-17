const http = require('http');

const login = () => {
  const data = JSON.stringify({
    email: 'x@test.com',
    password: 'x',
    role: 'student',
    captcha_id: 'abc',
    captcha_answer: 'abc'
  });

  const req = http.request('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      console.log('STATUS', res.statusCode);
      console.log('HEADERS', JSON.stringify(res.headers));
      console.log('BODY', body);
    });
  });

  req.on('error', (e) => {
    console.error('REQUEST_ERROR', e);
  });

  req.write(data);
  req.end();
};

login();
