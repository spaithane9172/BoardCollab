const express = require('express');
const router = express.Router();
const roomController = require('../controllers/room.controller');
const { authenticate, optionalAuthenticate } = require('../middleware/auth.middleware');

router.post('/', authenticate, roomController.createRoom);
router.get('/', authenticate, roomController.getUserRooms);
router.get('/:id', optionalAuthenticate, roomController.getRoom);
router.post('/:id/join', authenticate, roomController.joinRoom);
router.post('/:id/members', authenticate, roomController.addMember);
router.post('/:id/leave', authenticate, roomController.leaveRoom);
router.post('/:id/export', authenticate, roomController.exportRoomCanvas);

module.exports = router;
