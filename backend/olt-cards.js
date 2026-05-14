const express = require('express');
const db = require('./database');
const router = express.Router();

// ========== GET all cards for an OLT with their ports ==========
router.get('/:id/cards', (req, res) => {
  const oltId = req.params.id;
  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });

  const cards = db.prepare(`
    SELECT c.*, COUNT(p.id) as actual_ports
    FROM olt_cards c
    LEFT JOIN olt_ports p ON p.card_id = c.id
    WHERE c.olt_id = ?
    GROUP BY c.id
    ORDER BY c.slot_number ASC
  `).all(oltId);

  const getPorts = db.prepare(`
    SELECT * FROM olt_ports WHERE card_id = ? ORDER BY port_number ASC
  `);

  const result = cards.map(card => ({
    ...card,
    ports: getPorts.all(card.id)
  }));

  res.json({ cards: result });
});

// ========== CREATE a new card manually ==========
// Body: { ports_count: 8|16, slot_number?: number, name?: string, port_power?: number }
// port_power defaults to 2.5 for all ports if not specified
router.post('/:id/cards', (req, res) => {
  const oltId = parseInt(req.params.id);
  const { ports_count = 8, slot_number, name, port_power = 2.5 } = req.body;

  if (ports_count !== 8 && ports_count !== 16) {
    return res.status(400).json({ error: 'ports_count debe ser 8 o 16' });
  }

  const olt = db.prepare('SELECT * FROM olts WHERE id=?').get(oltId);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });

  // Determine next slot number if not provided
  let slotNum = slot_number;
  if (!slotNum) {
    const maxSlot = db.prepare('SELECT MAX(slot_number) as max_slot FROM olt_cards WHERE olt_id=?').get(oltId);
    slotNum = (maxSlot?.max_slot || 0) + 1;
  }

  const cardName = name || `Card ${slotNum}`;

  // Create the card (source='manual' for manually created)
  const cardResult = db.prepare(`
    INSERT INTO olt_cards (olt_id, slot_number, name, ports_count, source)
    VALUES (?, ?, ?, ?, 'manual')
  `).run(oltId, slotNum, cardName, ports_count);
  const cardId = cardResult.lastInsertRowid;

  // Create the ports with individual slot numbers
  const insertPort = db.prepare(`
    INSERT INTO olt_ports (olt_id, card_id, slot_number, port_number, power, name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const created = [];
  for (let i = 1; i <= ports_count; i++) {
    const portName = `${cardName} P${i}`;
    const portResult = insertPort.run(oltId, cardId, i, i, port_power, portName);
    created.push({
      id: portResult.lastInsertRowid,
      port_number: i,
      slot_number: i,
      power: port_power,
      name: portName
    });
  }

  // Update OLT ports_count
  db.prepare('UPDATE olts SET ports_count=ports_count+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(ports_count, oltId);

  res.json({
    card: {
      id: cardId,
      olt_id: oltId,
      slot_number: slotNum,
      name: cardName,
      ports_count,
      source: 'manual'
    },
    ports: created,
    message: `Tarjeta ${cardName} (${ports_count}P) creada con ${ports_count} puertos`
  });
});

// ========== UPDATE a card (name, slot_number) ==========
router.put('/:id/cards/:cardId', (req, res) => {
  const { id, cardId } = req.params;
  const { name, slot_number } = req.body;

  const card = db.prepare('SELECT * FROM olt_cards WHERE id=? AND olt_id=?').get(cardId, id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });

  if (name !== undefined) {
    db.prepare('UPDATE olt_cards SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, cardId);
  }
  if (slot_number !== undefined) {
    db.prepare('UPDATE olt_cards SET slot_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(slot_number, cardId);
  }

  const updated = db.prepare('SELECT * FROM olt_cards WHERE id=?').get(cardId);
  res.json({ card: updated, message: 'Tarjeta actualizada' });
});

// ========== DELETE a card and all its ports ==========
router.delete('/:id/cards/:cardId', (req, res) => {
  const { id, cardId } = req.params;

  const card = db.prepare('SELECT * FROM olt_cards WHERE id=? AND olt_id=?').get(cardId, id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });

  // First delete fiber connections for all ports on this card
  db.prepare(`
    DELETE FROM fiber_connections
    WHERE source_olt_port_id IN (SELECT id FROM olt_ports WHERE card_id=?)
  `).run(cardId);

  // Delete the card's ports (cascade should handle this, but explicit is safe)
  db.prepare('DELETE FROM olt_ports WHERE card_id=?').run(cardId);

  // Delete the card itself
  db.prepare('DELETE FROM olt_cards WHERE id=?').run(cardId);

  // Update OLT ports_count
  db.prepare('UPDATE olts SET ports_count=MAX(ports_count-?,0), updated_at=CURRENT_TIMESTAMP WHERE id=?').run(card.ports_count, id);

  res.json({ message: `Tarjeta ${card.name} y sus ${card.ports_count} puertos eliminados` });
});

// ========== SET power for a specific port on a card ==========
router.put('/:id/cards/:cardId/ports/:portNumber/power', (req, res) => {
  const { id, cardId, portNumber } = req.params;
  const { power } = req.body;

  if (power === undefined || isNaN(parseFloat(power))) {
    return res.status(400).json({ error: 'Potencia inválida' });
  }

  const port = db.prepare(`
    SELECT * FROM olt_ports WHERE card_id=? AND port_number=? AND olt_id=?
  `).get(cardId, portNumber, id);

  if (!port) return res.status(404).json({ error: 'Puerto no encontrado en esta tarjeta' });

  db.prepare('UPDATE olt_ports SET power=? WHERE id=?').run(parseFloat(power), port.id);

  res.json({
    message: `Potencia del puerto P${portNumber} actualizada a ${parseFloat(power).toFixed(1)} dBm`,
    power: parseFloat(power)
  });
});

// ========== SET power for all ports on a card at once ==========
router.put('/:id/cards/:cardId/power', (req, res) => {
  const { id, cardId } = req.params;
  const { power } = req.body;

  if (power === undefined || isNaN(parseFloat(power))) {
    return res.status(400).json({ error: 'Potencia inválida' });
  }

  const card = db.prepare('SELECT * FROM olt_cards WHERE id=? AND olt_id=?').get(cardId, id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });

  db.prepare('UPDATE olt_ports SET power=? WHERE card_id=?').run(parseFloat(power), cardId);

  res.json({
    message: `Potencia de todos los puertos de ${card.name} actualizada a ${parseFloat(power).toFixed(1)} dBm`
  });
});

module.exports = router;
