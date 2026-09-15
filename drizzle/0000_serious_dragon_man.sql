CREATE TABLE `attachments` (
	`id` varchar(36) NOT NULL,
	`commentId` varchar(36) NOT NULL,
	`storageKey` varchar(255) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`byteSize` int unsigned NOT NULL,
	`durationMs` int unsigned,
	`transcription` text,
	`transcriptionStatus` enum('pending','processing','completed','failed'),
	`transcriptionProvider` varchar(80),
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`authorId` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`body` text NOT NULL,
	`status` enum('open','resolved') NOT NULL DEFAULT 'open',
	`kind` enum('text','audio','text-suggestion') NOT NULL DEFAULT 'text',
	`anchor` json NOT NULL,
	`originalText` text,
	`suggestedText` text,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	`updatedAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `comments_project_number_unique` UNIQUE(`projectId`,`number`)
);
--> statement-breakpoint
CREATE TABLE `otp_challenges` (
	`email` varchar(254) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`name` varchar(80),
	`attempts` int unsigned NOT NULL DEFAULT 0,
	`expiresAt` timestamp(3) NOT NULL,
	`consumedAt` timestamp(3),
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `otp_challenges_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`ownerId` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text,
	`type` enum('website','pdf') NOT NULL,
	`url` text,
	`fileName` varchar(255),
	`storageKey` varchar(80),
	`fileSize` int unsigned,
	`shareToken` varchar(64) NOT NULL,
	`archived` boolean NOT NULL DEFAULT false,
	`nextCommentNumber` int unsigned NOT NULL DEFAULT 1,
	`commentCount` int unsigned NOT NULL DEFAULT 0,
	`resolvedCount` int unsigned NOT NULL DEFAULT 0,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	`updatedAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_share_token_unique` UNIQUE(`shareToken`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` varchar(64) NOT NULL,
	`count` int unsigned NOT NULL DEFAULT 0,
	`expiresAt` timestamp(3) NOT NULL,
	CONSTRAINT `rate_limits_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` varchar(36) NOT NULL,
	`commentId` varchar(36) NOT NULL,
	`authorId` varchar(36) NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`tokenHash` varchar(64) NOT NULL,
	`userId` varchar(36) NOT NULL,
	`expiresAt` timestamp(3) NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_tokenHash` PRIMARY KEY(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`name` varchar(80) NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_commentId_comments_id_fk` FOREIGN KEY (`commentId`) REFERENCES `comments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `replies` ADD CONSTRAINT `replies_commentId_comments_id_fk` FOREIGN KEY (`commentId`) REFERENCES `comments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `replies` ADD CONSTRAINT `replies_authorId_users_id_fk` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attachments_comment_idx` ON `attachments` (`commentId`);--> statement-breakpoint
CREATE INDEX `comments_author_idx` ON `comments` (`authorId`);--> statement-breakpoint
CREATE INDEX `otp_expiry_idx` ON `otp_challenges` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`ownerId`);--> statement-breakpoint
CREATE INDEX `rate_limits_expiry_idx` ON `rate_limits` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `replies_comment_idx` ON `replies` (`commentId`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expiresAt`);