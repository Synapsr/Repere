-- One atomic CREATE keeps this additive migration safe to replay after interrupted startup.
CREATE TABLE IF NOT EXISTS `comment_screenshots` (
	`commentId` varchar(36) NOT NULL,
	`storageKey` varchar(80) NOT NULL,
	`byteSize` int unsigned NOT NULL,
	`width` int unsigned NOT NULL,
	`height` int unsigned NOT NULL,
	`pointX` double NOT NULL,
	`pointY` double NOT NULL,
	`capturedAt` datetime(3) NOT NULL,
	`createdAt` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `comment_screenshots_commentId` PRIMARY KEY(`commentId`),
	CONSTRAINT `comment_screenshots_commentId_comments_id_fk` FOREIGN KEY (`commentId`) REFERENCES `comments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
);
