module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'server/services/**/*.js',
    'server/config/**/*.js',
    '!server/scripts/**',
  ],
}
