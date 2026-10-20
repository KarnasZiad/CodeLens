import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/fixtures.js';
import { healthRouter } from './health-router.js';

describe('health', () => {
  it('is live without checking dependencies', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/health/live')).body).toEqual({ status: 'up' });
  });

  it('is ready when every dependency answers', async () => {
    const { app, health } = createTestApp();
    health.redis = () => Promise.resolve('PONG');
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'up', dependencies: { postgres: 'up', redis: 'up' } });
  });

  it('is not ready when a dependency fails', async () => {
    const { app, health } = createTestApp();
    health.mongodb = () => Promise.reject(new Error('down'));
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'down',
      dependencies: { postgres: 'up', mongodb: 'down' },
    });
  });

  it('does not wait for a dependency that hangs', async () => {
    const app = express().use(
      '/health',
      healthRouter({ mongodb: () => new Promise(() => undefined) }, { timeoutMs: 20 }),
    );
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.dependencies).toEqual({ mongodb: 'down' });
  });
});
