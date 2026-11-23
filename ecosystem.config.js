module.exports = { apps: [{ name: 'otoqol', script: 'src/server.js', node_args: '--env-file=.env', instances: 1, autorestart: true, max_memory_restart: '300M' }] };
