import { Router } from 'express';
import { z } from 'zod';
import { DOMAIN_EVENT_TYPES } from '../events/eventBus.js';
import { principalOf, requireRole } from '../middleware/auth.js';
import type { WebhookDelivery, WebhookEndpoint } from '../models/webhook.js';
import type { WebhookService } from '../webhooks/webhookService.js';
import { asyncHandler } from './asyncHandler.js';

const webhookUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Webhook URLs must use https');

const EndpointFields = z.object({
  url: webhookUrl,
  description: z.string().trim().max(200).optional(),
  events: z.array(z.enum(DOMAIN_EVENT_TYPES)).min(1),
});

const CreateEndpointSchema = EndpointFields;

const UpdateEndpointSchema = EndpointFields.extend({ active: z.boolean() })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field must be provided');

const ListDeliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function webhooksRouter(service: WebhookService): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const endpoints = await service.listEndpoints(principalOf(req));
      res.json({ data: endpoints.map((endpoint) => serializeEndpoint(endpoint)) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = CreateEndpointSchema.parse(req.body);
      const endpoint = await service.createEndpoint(principalOf(req), input);
      // The signing secret is only ever shown once, at creation time.
      res.status(201).json({ data: serializeEndpoint(endpoint, { includeSecret: true }) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const endpoint = await service.getEndpoint(principalOf(req), req.params.id);
      res.json({ data: serializeEndpoint(endpoint) });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const patch = UpdateEndpointSchema.parse(req.body);
      const endpoint = await service.updateEndpoint(principalOf(req), req.params.id, patch);
      res.json({ data: serializeEndpoint(endpoint) });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await service.deleteEndpoint(principalOf(req), req.params.id);
      res.status(204).end();
    }),
  );

  router.get(
    '/:id/deliveries',
    asyncHandler(async (req, res) => {
      const { limit } = ListDeliveriesQuery.parse(req.query);
      const deliveries = await service.listDeliveries(req.params.id, limit);
      res.json({ data: deliveries.map(serializeDelivery) });
    }),
  );

  router.post(
    '/:id/deliveries/:deliveryId/retry',
    asyncHandler(async (req, res) => {
      const delivery = await service.retryDelivery(principalOf(req), req.params.id, req.params.deliveryId);
      res.status(202).json({ data: serializeDelivery(delivery) });
    }),
  );

  return router;
}

function serializeEndpoint(endpoint: WebhookEndpoint, options: { includeSecret?: boolean } = {}) {
  const { secret, ...rest } = endpoint;
  return {
    ...rest,
    ...(options.includeSecret ? { secret } : {}),
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

function serializeDelivery(delivery: WebhookDelivery) {
  return {
    ...delivery,
    payload: JSON.parse(delivery.payload) as unknown,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    lastAttemptAt: delivery.lastAttemptAt?.toISOString(),
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}
