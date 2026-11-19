#!/usr/bin/env ruby
# frozen_string_literal: true

require 'socket'
require 'json'
require 'time'
require 'securerandom'
require 'fileutils'
require 'uri'

PORT = (ENV['PORT'] || 8080).to_i
HOST = ENV['HOST'] || '0.0.0.0'
ROOT_DIR = File.expand_path(__dir__)
PUBLIC_DIR = File.join(ROOT_DIR, 'public')
DATA_DIR = File.join(ROOT_DIR, 'data')
STORE_FILE = File.join(DATA_DIR, 'store.json')

FileUtils.mkdir_p(DATA_DIR)

MIME_TYPES = {
  '.html' => 'text/html; charset=utf-8',
  '.css'  => 'text/css; charset=utf-8',
  '.js'   => 'application/javascript; charset=utf-8',
  '.json' => 'application/json; charset=utf-8',
  '.svg'  => 'image/svg+xml',
  '.png'  => 'image/png',
  '.jpg'  => 'image/jpeg',
  '.jpeg' => 'image/jpeg',
  '.webp' => 'image/webp',
  '.ico'  => 'image/x-icon'
}.freeze

def detect_lan_ip
  ips = Socket.ip_address_list.select { |a| a.ipv4? && !a.ipv4_loopback? && a.ipv4_private? }.map(&:ip_address)
  # Prefer common home/office Wi-Fi subnets (192.168.x.x, then 10.x.x.x, then 172.16-31.x.x)
  ips.find { |ip| ip.start_with?('192.168.') } ||
    ips.find { |ip| ip.start_with?('10.') } ||
    ips.first ||
    '127.0.0.1'
rescue StandardError
  '127.0.0.1'
end

def default_tables
  layout = [
    { id: 1,  name: 'Table 1',  seats: 2, zone: 'Window' },
    { id: 2,  name: 'Table 2',  seats: 2, zone: 'Window' },
    { id: 3,  name: 'Table 3',  seats: 2, zone: 'Window' },
    { id: 4,  name: 'Table 4',  seats: 4, zone: 'Main Hall' },
    { id: 5,  name: 'Table 5',  seats: 4, zone: 'Main Hall' },
    { id: 6,  name: 'Table 6',  seats: 4, zone: 'Main Hall' },
    { id: 7,  name: 'Table 7',  seats: 4, zone: 'Main Hall' },
    { id: 8,  name: 'Table 8',  seats: 6, zone: 'Courtyard' },
    { id: 9,  name: 'Table 9',  seats: 6, zone: 'Courtyard' },
    { id: 10, name: 'Table 10', seats: 8, zone: "Chef's Alcove" }
  ]
  layout.map do |t|
    t.merge(
      sessionId: "S#{t[:id]}-#{SecureRandom.hex(3).upcase}",
      billRequested: false,
      billRequestedAt: nil
    )
  end
end

class RestaurantStore
  def initialize(file_path)
    @file_path = file_path
    @mutex = Mutex.new
    @sse_clients = []
    @sse_mutex = Mutex.new
    @state = load_state
  end

  def initial_state
    {
      'restaurantName' => 'Saffron & Ember',
      'taxRate' => 5.0,
      'nextOrderNumber' => 101,
      'nextInvoiceNumber' => 1001,
      'tables' => default_tables.map { |t| t.transform_keys(&:to_s) },
      'orders' => [],
      'bills' => []
    }
  end

  def load_state
    if File.exist?(@file_path)
      parsed = JSON.parse(File.read(@file_path))
      if parsed.is_a?(Hash) && parsed['tables'].is_a?(Array) && parsed['tables'].length == 10
        return parsed
      end
    end
    state = initial_state
    save_state_unlocked(state)
    state
  rescue StandardError
    state = initial_state
    save_state_unlocked(state)
    state
  end

  def save_state_unlocked(state = @state)
    tmp = "#{@file_path}.tmp"
    File.write(tmp, JSON.pretty_generate(state))
    File.rename(tmp, @file_path)
  end

  def snapshot
    @mutex.synchronize { JSON.parse(JSON.generate(@state)) }
  end

  def add_sse_client(socket)
    @sse_mutex.synchronize { @sse_clients << socket }
  end

  def remove_sse_client(socket)
    @sse_mutex.synchronize { @sse_clients.delete(socket) }
  end

  def broadcast(event_type, payload = {})
    message = {
      type: event_type,
      payload: payload,
      state: snapshot,
      timestamp: Time.now.utc.iso8601
    }
    frame = "event: update\ndata: #{JSON.generate(message)}\n\n"
    dead = []
    @sse_mutex.synchronize do
      @sse_clients.each do |client|
        begin
          client.write(frame)
          client.flush
        rescue StandardError
          dead << client
        end
      end
      dead.each { |c| @sse_clients.delete(c) }
    end
  end

  def send_heartbeats
    dead = []
    @sse_mutex.synchronize do
      @sse_clients.each do |client|
        begin
          client.write(": ping #{Time.now.to_i}\n\n")
          client.flush
        rescue StandardError
          dead << client
        end
      end
      dead.each { |c| @sse_clients.delete(c) }
    end
  end

  def create_order(params)
    table_id = params['tableId'].to_i
    raise ArgumentError, 'Invalid table ID (must be 1-10)' unless (1..10).include?(table_id)

    raw_items = params['items']
    raise ArgumentError, 'Order must contain at least one item' unless raw_items.is_a?(Array) && !raw_items.empty?

    items = raw_items.map do |it|
      qty = it['qty'].to_i
      raise ArgumentError, 'Item quantity must be positive' if qty <= 0

      {
        'itemId' => it['itemId'].to_s,
        'name' => it['name'].to_s,
        'category' => (it['category'] || '').to_s,
        'price' => it['price'].to_f.round(2),
        'qty' => qty,
        'veg' => !!it['veg'],
        'notes' => (it['notes'] || '').to_s.strip
      }
    end

    order = nil
    @mutex.synchronize do
      table = @state['tables'].find { |t| t['id'] == table_id }
      raise ArgumentError, 'Table not found' unless table

      now = Time.now.utc.iso8601
      order_num = @state['nextOrderNumber']
      @state['nextOrderNumber'] = order_num + 1

      subtotal = items.sum { |i| i['price'] * i['qty'] }.round(2)
      order = {
        'id' => "ORD-#{order_num}",
        'orderNumber' => order_num,
        'tableId' => table_id,
        'tableName' => table['name'],
        'sessionId' => table['sessionId'],
        'guestName' => (params['guestName'] || '').to_s.strip,
        'orderNote' => (params['orderNote'] || '').to_s.strip,
        'items' => items,
        'subtotal' => subtotal,
        'status' => 'pending',
        'billed' => false,
        'createdAt' => now,
        'updatedAt' => now,
        'startedAt' => nil,
        'readyAt' => nil,
        'servedAt' => nil
      }

      @state['orders'].unshift(order)
      # If they had previously requested a bill and added more items, keep billRequested accurate
      save_state_unlocked
    end

    broadcast('order_created', { order: order })
    order
  end

  def update_order_status(order_id, new_status)
    allowed = %w[pending preparing ready served cancelled]
    raise ArgumentError, 'Invalid status' unless allowed.include?(new_status)

    order = nil
    @mutex.synchronize do
      order = @state['orders'].find { |o| o['id'] == order_id }
      raise ArgumentError, 'Order not found' unless order

      now = Time.now.utc.iso8601
      order['status'] = new_status
      order['updatedAt'] = now
      order['startedAt'] ||= now if new_status == 'preparing'
      order['readyAt'] ||= now if new_status == 'ready'
      order['servedAt'] ||= now if new_status == 'served'
      save_state_unlocked
    end

    broadcast('order_updated', { order: order })
    order
  end

  def request_bill(table_id)
    table_id = table_id.to_i
    raise ArgumentError, 'Invalid table ID' unless (1..10).include?(table_id)

    table = nil
    @mutex.synchronize do
      table = @state['tables'].find { |t| t['id'] == table_id }
      raise ArgumentError, 'Table not found' unless table

      table['billRequested'] = true
      table['billRequestedAt'] = Time.now.utc.iso8601
      save_state_unlocked
    end

    broadcast('bill_requested', { tableId: table_id, tableName: table['name'] })
    table
  end

  def settle_table(table_id, params)
    table_id = table_id.to_i
    raise ArgumentError, 'Invalid table ID' unless (1..10).include?(table_id)

    discount_pct = [[params['discountPercent'].to_f, 0.0].max, 100.0].min
    payment_method = (params['paymentMethod'] || 'Card').to_s

    bill = nil
    @mutex.synchronize do
      table = @state['tables'].find { |t| t['id'] == table_id }
      raise ArgumentError, 'Table not found' unless table

      session_id = table['sessionId']
      active_orders = @state['orders'].select do |o|
        o['tableId'] == table_id && o['sessionId'] == session_id && !o['billed'] && o['status'] != 'cancelled'
      end
      raise ArgumentError, 'No active unbilled orders for this table' if active_orders.empty?

      # Consolidate items across rounds
      item_map = {}
      active_orders.reverse.each do |ord|
        ord['items'].each do |it|
          key = "#{it['itemId']}|#{it['price']}"
          if item_map[key]
            item_map[key]['qty'] += it['qty']
            item_map[key]['lineTotal'] = (item_map[key]['qty'] * item_map[key]['price']).round(2)
          else
            item_map[key] = {
              'itemId' => it['itemId'],
              'name' => it['name'],
              'price' => it['price'],
              'qty' => it['qty'],
              'lineTotal' => (it['qty'] * it['price']).round(2)
            }
          end
        end
      end

      subtotal = item_map.values.sum { |i| i['lineTotal'] }.round(2)
      discount_amount = (subtotal * discount_pct / 100.0).round(2)
      taxable = (subtotal - discount_amount).round(2)
      tax_rate = @state['taxRate'].to_f
      tax_amount = (taxable * tax_rate / 100.0).round(2)
      grand_total = (taxable + tax_amount).round(2)

      inv_num = @state['nextInvoiceNumber']
      @state['nextInvoiceNumber'] = inv_num + 1
      now = Time.now.utc.iso8601

      bill = {
        'id' => "INV-#{inv_num}",
        'invoiceNumber' => inv_num,
        'tableId' => table_id,
        'tableName' => table['name'],
        'sessionId' => session_id,
        'orderIds' => active_orders.map { |o| o['id'] },
        'items' => item_map.values,
        'subtotal' => subtotal,
        'discountPercent' => discount_pct,
        'discountAmount' => discount_amount,
        'taxRate' => tax_rate,
        'taxAmount' => tax_amount,
        'grandTotal' => grand_total,
        'paymentMethod' => payment_method,
        'paidAt' => now
      }

      active_orders.each do |o|
        o['billed'] = true
        o['status'] = 'served' if %w[pending preparing ready].include?(o['status'])
        o['updatedAt'] = now
      end

      @state['bills'].unshift(bill)
      table['billRequested'] = false
      table['billRequestedAt'] = nil
      table['sessionId'] = "S#{table_id}-#{SecureRandom.hex(3).upcase}"
      save_state_unlocked
    end

    broadcast('bill_settled', { bill: bill })
    bill
  end

  def reset_all
    @mutex.synchronize do
      @state = initial_state
      save_state_unlocked
    end
    broadcast('system_reset', {})
    @state
  end

  def seed_demo
    now = Time.now.utc
    @mutex.synchronize do
      t2 = @state['tables'].find { |t| t['id'] == 2 }
      t4 = @state['tables'].find { |t| t['id'] == 4 }
      t7 = @state['tables'].find { |t| t['id'] == 7 }

      samples = [
        {
          table: t2, status: 'ready', mins_ago: 14, guest: 'Aarav', note: 'Serve chutney on the side',
          items: [
            { 'itemId' => 'st-1', 'name' => 'Charred Paneer Tikka', 'category' => 'Starters', 'price' => 340, 'qty' => 1, 'veg' => true, 'notes' => 'Less spicy' },
            { 'itemId' => 'dr-1', 'name' => 'Kokum & Rose Cooler', 'category' => 'Beverages', 'price' => 180, 'qty' => 2, 'veg' => true, 'notes' => '' }
          ]
        },
        {
          table: t4, status: 'preparing', mins_ago: 7, guest: 'Meera & Guests', note: 'Allergies: No peanuts',
          items: [
            { 'itemId' => 'mn-1', 'name' => 'Saffron Butter Chicken', 'category' => 'Mains', 'price' => 520, 'qty' => 2, 'veg' => false, 'notes' => '' },
            { 'itemId' => 'mn-2', 'name' => '24-Hour Smoked Dal Makhani', 'category' => 'Mains', 'price' => 420, 'qty' => 1, 'veg' => true, 'notes' => '' },
            { 'itemId' => 'br-1', 'name' => 'Blistered Garlic Naan', 'category' => 'Breads & Rice', 'price' => 110, 'qty' => 4, 'veg' => true, 'notes' => 'Extra butter' }
          ]
        },
        {
          table: t7, status: 'pending', mins_ago: 2, guest: 'Rohan', note: '',
          items: [
            { 'itemId' => 'st-3', 'name' => 'Crispy Lotus Stem Honey Chili', 'category' => 'Starters', 'price' => 320, 'qty' => 1, 'veg' => true, 'notes' => 'Extra crispy' },
            { 'itemId' => 'wf-1', 'name' => 'Truffle Wild Mushroom Flatbread', 'category' => 'Wood-Fired', 'price' => 490, 'qty' => 1, 'veg' => true, 'notes' => '' },
            { 'itemId' => 'ds-1', 'name' => 'Warm Pistachio Gulab Jamun', 'category' => 'Desserts', 'price' => 260, 'qty' => 2, 'veg' => true, 'notes' => 'Bring after mains' }
          ]
        }
      ]

      samples.each do |s|
        order_num = @state['nextOrderNumber']
        @state['nextOrderNumber'] = order_num + 1
        created = (now - (s[:mins_ago] * 60)).iso8601
        subtotal = s[:items].sum { |i| i['price'] * i['qty'] }.round(2)
        @state['orders'].unshift(
          'id' => "ORD-#{order_num}",
          'orderNumber' => order_num,
          'tableId' => s[:table]['id'],
          'tableName' => s[:table]['name'],
          'sessionId' => s[:table]['sessionId'],
          'guestName' => s[:guest],
          'orderNote' => s[:note],
          'items' => s[:items],
          'subtotal' => subtotal,
          'status' => s[:status],
          'billed' => false,
          'createdAt' => created,
          'updatedAt' => created,
          'startedAt' => (%w[preparing ready].include?(s[:status]) ? created : nil),
          'readyAt' => (s[:status] == 'ready' ? created : nil),
          'servedAt' => nil
        )
      end

      t2['billRequested'] = true
      t2['billRequestedAt'] = now.iso8601
      save_state_unlocked
    end

    broadcast('demo_seeded', {})
    snapshot
  end
end

def send_response(socket, status_code, status_text, content_type, body, extra_headers = {})
  body_bytes = body.is_a?(String) ? body.b : body.to_s.b
  headers = [
    "HTTP/1.1 #{status_code} #{status_text}",
    "Content-Type: #{content_type}",
    "Content-Length: #{body_bytes.bytesize}",
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers: Content-Type',
    'Cache-Control: no-cache',
    'Connection: close'
  ]
  extra_headers.each { |k, v| headers << "#{k}: #{v}" }
  socket.write("#{headers.join("\r\n")}\r\n\r\n")
  socket.write(body_bytes)
  socket.flush
end

def send_json(socket, status_code, data)
  status_text = { 200 => 'OK', 201 => 'Created', 400 => 'Bad Request', 404 => 'Not Found', 500 => 'Internal Server Error' }[status_code] || 'OK'
  send_response(socket, status_code, status_text, 'application/json; charset=utf-8', JSON.generate(data))
end

def read_http_request(socket)
  request_line = socket.gets("\n")
  return nil unless request_line

  parts = request_line.strip.split(' ')
  return nil if parts.length < 2

  method = parts[0]
  raw_target = parts[1]
  path, query = raw_target.split('?', 2)

  headers = {}
  while (line = socket.gets("\n"))
    line = line.strip
    break if line.empty?

    key, val = line.split(':', 2)
    headers[key.downcase.strip] = val.strip if key && val
  end

  body = ''
  content_length = headers['content-length'].to_i
  if content_length > 0
    body = socket.read(content_length) || ''
  end

  { method: method, path: URI.decode_www_form_component(path), query: query, headers: headers, body: body }
rescue StandardError
  nil
end

def serve_static(socket, req_path)
  clean = req_path == '/' ? '/index.html' : req_path
  # SPA routes all serve index.html
  if clean == '/kitchen' || clean == '/billing' || clean == '/qr-codes' || clean =~ %r{\A/table/\d+\z}
    clean = '/index.html'
  end

  full_path = File.expand_path(File.join(PUBLIC_DIR, clean))
  unless full_path.start_with?(PUBLIC_DIR) && File.file?(full_path)
    return send_response(socket, 404, 'Not Found', 'text/plain; charset=utf-8', 'Not Found')
  end

  ext = File.extname(full_path).downcase
  mime = MIME_TYPES[ext] || 'application/octet-stream'
  content = File.binread(full_path)
  send_response(socket, 200, 'OK', mime, content)
end

store = RestaurantStore.new(STORE_FILE)
lan_ip = detect_lan_ip

# Background SSE heartbeat thread
Thread.new do
  loop do
    sleep 20
    store.send_heartbeats
  end
end

server = TCPServer.new(HOST, PORT)
puts '============================================================'
puts '  Saffron & Ember — Restaurant QR Ordering, Kitchen & POS'
puts '============================================================'
puts "  Local URL:       http://localhost:#{PORT}"
puts "  Wi-Fi / Phone:   http://#{lan_ip}:#{PORT}"
puts "  Kitchen Display: http://localhost:#{PORT}/kitchen"
puts "  Billing Counter: http://localhost:#{PORT}/billing"
puts "  10 Table QRs:    http://localhost:#{PORT}/qr-codes"
puts '============================================================'
$stdout.flush

trap('INT') { puts "\nShutting down..."; exit 0 }
trap('TERM') { puts "\nShutting down..."; exit 0 }

loop do
  client = server.accept
  Thread.new(client) do |socket|
    keep_open = false
    begin
      req = read_http_request(socket)
      next unless req

      method = req[:method]
      path = req[:path]

      if method == 'OPTIONS'
        send_response(socket, 204, 'No Content', 'text/plain', '')
        next
      end

      if method == 'GET' && path == '/api/events'
        keep_open = true
        sse_headers = [
          'HTTP/1.1 200 OK',
          'Content-Type: text/event-stream; charset=utf-8',
          'Cache-Control: no-cache, no-transform',
          'Connection: keep-alive',
          'Access-Control-Allow-Origin: *',
          'X-Accel-Buffering: no'
        ].join("\r\n") + "\r\n\r\n"
        socket.write(sse_headers)
        init_payload = {
          type: 'connected',
          state: store.snapshot,
          timestamp: Time.now.utc.iso8601
        }
        socket.write("event: update\ndata: #{JSON.generate(init_payload)}\n\n")
        socket.flush
        store.add_sse_client(socket)

        # Hold thread open until client disconnects
        begin
          loop do
            ready = IO.select([socket], nil, nil, 60)
            if ready
              chunk = socket.read_nonblock(16)
              break if chunk.nil? || chunk.empty?
            end
          end
        rescue StandardError
          # Client disconnected
        ensure
          store.remove_sse_client(socket)
          socket.close unless socket.closed?
        end
        next
      end

      if method == 'GET' && path == '/api/info'
        host_header = req[:headers]['host']
        send_json(socket, 200, {
          restaurantName: 'Saffron & Ember',
          lanIp: lan_ip,
          port: PORT,
          lanBaseUrl: "http://#{lan_ip}:#{PORT}",
          localBaseUrl: "http://localhost:#{PORT}",
          requestHost: host_header
        })
      elsif method == 'GET' && path == '/api/state'
        send_json(socket, 200, store.snapshot)
      elsif method == 'POST' && path == '/api/orders'
        params = req[:body].empty? ? {} : JSON.parse(req[:body])
        order = store.create_order(params)
        send_json(socket, 201, { ok: true, order: order })
      elsif method == 'PATCH' && path =~ %r{\A/api/orders/([^/]+)/status\z}
        order_id = Regexp.last_match(1)
        params = req[:body].empty? ? {} : JSON.parse(req[:body])
        order = store.update_order_status(order_id, params['status'])
        send_json(socket, 200, { ok: true, order: order })
      elsif method == 'POST' && path =~ %r{\A/api/tables/(\d+)/request-bill\z}
        table_id = Regexp.last_match(1)
        table = store.request_bill(table_id)
        send_json(socket, 200, { ok: true, table: table })
      elsif method == 'POST' && path =~ %r{\A/api/tables/(\d+)/settle\z}
        table_id = Regexp.last_match(1)
        params = req[:body].empty? ? {} : JSON.parse(req[:body])
        bill = store.settle_table(table_id, params)
        send_json(socket, 200, { ok: true, bill: bill })
      elsif method == 'POST' && path == '/api/demo/seed'
        state = store.seed_demo
        send_json(socket, 200, { ok: true, state: state })
      elsif method == 'POST' && path == '/api/demo/reset'
        state = store.reset_all
        send_json(socket, 200, { ok: true, state: state })
      elsif method == 'GET'
        serve_static(socket, path)
      else
        send_json(socket, 404, { error: 'Endpoint not found' })
      end
    rescue ArgumentError => e
      send_json(socket, 400, { error: e.message }) rescue nil
    rescue JSON::ParserError
      send_json(socket, 400, { error: 'Invalid JSON payload' }) rescue nil
    rescue StandardError => e
      send_json(socket, 500, { error: e.message }) rescue nil
    ensure
      socket.close unless keep_open || socket.closed?
    end
  end
end
