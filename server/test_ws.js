const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:5000/ws');

ws.on('open', function open() {
  console.log('Connected to WebSocket');
  // Send a test transcript
  ws.send(JSON.stringify({ type: 'transcript', text: 'Hello world' }));
});

ws.on('message', function incoming(data) {
  console.log('Received:', data.toString());
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

ws.on('close', function close() {
  console.log('WebSocket closed');
});
