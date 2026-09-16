-- Inline constraints keep the additive DDL atomic and safe to replay before journaling.
CREATE TABLE IF NOT EXISTS `project_covers` (
	`projectId` varchar(36) NOT NULL,
	`automaticStorageKey` varchar(80),
	`customStorageKey` varchar(80),
	`version` varchar(36) NOT NULL,
	CONSTRAINT `project_covers_projectId` PRIMARY KEY(`projectId`),
	CONSTRAINT `project_covers_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
);
