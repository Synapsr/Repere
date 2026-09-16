-- All indexes and constraints are part of one atomic MySQL CREATE. Safe to replay after an interrupted startup.
CREATE TABLE IF NOT EXISTS `workspace_invitations` (
	`id` varchar(36) NOT NULL,
	`workspaceId` varchar(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`inviterId` varchar(36),
	`tokenHash` varchar(64),
	`pendingTokenHash` varchar(64),
	`pendingStartedAt` timestamp(3),
	`expiresAt` timestamp(3) NOT NULL,
	`acceptedAt` timestamp(3),
	`revokedAt` timestamp(3),
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	`updatedAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `workspace_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_invitations_workspace_email_unique` UNIQUE(`workspaceId`,`email`),
	CONSTRAINT `workspace_invitations_token_unique` UNIQUE(`tokenHash`),
	CONSTRAINT `workspace_invitations_pending_token_unique` UNIQUE(`pendingTokenHash`)
,
	INDEX `workspace_invitations_expiry_idx` (`expiresAt`),
	CONSTRAINT `workspace_invitations_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
	CONSTRAINT `workspace_invitations_inviterId_users_id_fk` FOREIGN KEY (`inviterId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION
);
