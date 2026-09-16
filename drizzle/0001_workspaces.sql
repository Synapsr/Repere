-- This upgrade is safe to resume after MySQL commits a DDL statement and startup stops.
-- Legacy user IDs are valid UUIDs and provide one deterministic workspace per project owner.
CREATE TABLE IF NOT EXISTS `workspaces` (
  `id` varchar(36) NOT NULL,
  `name` varchar(80) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT (now()),
  `updatedAt` timestamp(3) NOT NULL DEFAULT (now()),
  CONSTRAINT `workspaces_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_members` (
  `workspaceId` varchar(36) NOT NULL,
  `userId` varchar(36) NOT NULL,
  `role` enum('owner','member') NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT (now()),
  CONSTRAINT `workspace_members_workspaceId_userId_pk` PRIMARY KEY (`workspaceId`,`userId`),
  INDEX `workspace_members_user_idx` (`userId`),
  CONSTRAINT `workspace_members_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `workspace_members_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
);
--> statement-breakpoint
SET @repere_workspace_sql = IF(NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'workspaceId'), 'ALTER TABLE `projects` ADD `workspaceId` varchar(36) NULL', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'createdBy'), 'ALTER TABLE `projects` ADD `createdBy` varchar(36) NULL', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_legacy_owner = EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'ownerId');
--> statement-breakpoint
SET @repere_workspace_sql = IF(@repere_legacy_owner, 'INSERT INTO `workspaces` (`id`,`name`,`createdAt`,`updatedAt`) SELECT p.`ownerId`, LEFT(COALESCE(NULLIF(TRIM(u.`name`),''''),''Workspace''),80), MIN(p.`createdAt`), MIN(p.`createdAt`) FROM `projects` p INNER JOIN `users` u ON u.`id` = p.`ownerId` WHERE NOT EXISTS (SELECT 1 FROM `workspaces` w WHERE w.`id` = p.`ownerId`) GROUP BY p.`ownerId`, u.`name`', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(@repere_legacy_owner, 'INSERT INTO `workspace_members` (`workspaceId`,`userId`,`role`) SELECT DISTINCT p.`ownerId`, p.`ownerId`, ''owner'' FROM `projects` p WHERE NOT EXISTS (SELECT 1 FROM `workspace_members` m WHERE m.`workspaceId` = p.`ownerId` AND m.`userId` = p.`ownerId`)', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(@repere_legacy_owner, 'UPDATE `projects` SET `workspaceId` = COALESCE(`workspaceId`,`ownerId`), `createdBy` = COALESCE(`createdBy`,`ownerId`)', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
-- Refuse to drop the legacy authority until every project has a valid workspace.
ALTER TABLE `projects` MODIFY `workspaceId` varchar(36) NOT NULL;
--> statement-breakpoint
SET @repere_workspace_sql = IF(NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'projects_workspace_idx'), 'CREATE INDEX `projects_workspace_idx` ON `projects` (`workspaceId`)', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'projects_workspaceId_workspaces_id_fk'), 'ALTER TABLE `projects` ADD CONSTRAINT `projects_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'projects_createdBy_users_id_fk'), 'ALTER TABLE `projects` ADD CONSTRAINT `projects_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'projects_ownerId_users_id_fk'), 'ALTER TABLE `projects` DROP FOREIGN KEY `projects_ownerId_users_id_fk`', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'projects_owner_idx'), 'DROP INDEX `projects_owner_idx` ON `projects`', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
--> statement-breakpoint
SET @repere_workspace_sql = IF(EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'ownerId'), 'ALTER TABLE `projects` DROP COLUMN `ownerId`', 'SELECT 1');
--> statement-breakpoint
PREPARE repere_workspace_upgrade FROM @repere_workspace_sql;
--> statement-breakpoint
EXECUTE repere_workspace_upgrade;
--> statement-breakpoint
DEALLOCATE PREPARE repere_workspace_upgrade;
