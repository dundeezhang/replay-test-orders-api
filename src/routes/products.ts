import { Router } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../lib/errors.js';
import { SUPPORTED_CURRENCIES } from '../lib/money.js';
import { principalOf, requireRole } from '../middleware/auth.js';
import type { Product } from '../models/product.js';
import type { ProductRepository } from '../repositories/productRepository.js';
import { asyncHandler } from './asyncHandler.js';

const CreateProductSchema = z.object({
  sku: z.string().regex(/^[A-Za-z0-9-]{3,32}$/, 'SKU must be 3-32 letters, digits or dashes'),
  name: z.string().trim().min(1).max(200),
  priceCents: z.number().int().nonnegative(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  stockOnHand: z.number().int().nonnegative().default(0),
  active: z.boolean().optional(),
});

const UpdateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    priceCents: z.number().int().nonnegative(),
    stockOnHand: z.number().int().nonnegative(),
    active: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field must be provided');

export function productsRouter(products: ProductRepository): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const list = await products.list(principalOf(req).merchantId);
      res.json({ data: list.map(serializeProduct) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const product = await products.findById(principalOf(req).merchantId, req.params.id);
      if (!product) {
        throw new NotFoundError('Product', req.params.id);
      }
      res.json({ data: serializeProduct(product) });
    }),
  );

  router.post(
    '/',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const input = CreateProductSchema.parse(req.body);
      const product = await products.create(principalOf(req).merchantId, input);
      res.status(201).json({ data: serializeProduct(product) });
    }),
  );

  router.patch(
    '/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const patch = UpdateProductSchema.parse(req.body);
      const product = await products.update(principalOf(req).merchantId, req.params.id, patch);
      res.json({ data: serializeProduct(product) });
    }),
  );

  return router;
}

export function serializeProduct(product: Product) {
  return {
    ...product,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
