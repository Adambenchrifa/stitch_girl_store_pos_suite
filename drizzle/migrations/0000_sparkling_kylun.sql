CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pos_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`terminal_id` integer NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`opening_balance` integer NOT NULL,
	`closing_balance` integer,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pos_terminals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_terminals_name_unique` ON `pos_terminals` (`name`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`sku` text NOT NULL,
	`price_override` integer,
	`stock` integer DEFAULT 0 NOT NULL,
	`size` text,
	`size_type` text,
	`color` text,
	`image_url` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`category_id` integer NOT NULL,
	`brand` text,
	`description` text,
	`base_price` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`restock_decision` text NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`reason` text NOT NULL,
	`refund_method` text NOT NULL,
	`restock_reason` text,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`terminal_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`customer_id` text,
	`total` integer NOT NULL,
	`payment_method` text NOT NULL,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `pos_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`alert_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`signed_quantity` integer NOT NULL,
	`type` text NOT NULL,
	`reference_id` text,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
