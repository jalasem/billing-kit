import type { DbOrTx } from "@/db/client";
import { products, type Product } from "@/db/schema";

export interface CreateProductInput {
  name: string;
  description?: string;
  active?: boolean;
}

export async function createProduct(db: DbOrTx, input: CreateProductInput): Promise<Product> {
  const [product] = await db
    .insert(products)
    .values({ name: input.name, description: input.description, active: input.active ?? true })
    .returning();
  return product;
}
