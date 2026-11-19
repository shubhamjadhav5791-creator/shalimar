/**
 * Saffron & Ember — Curated Restaurant Menu
 */
(function (global) {
  'use strict';

  const CURRENCY = '₹';

  const CATEGORIES = [
    { id: 'Starters',      label: 'Small Plates & Starters', image: '/images/cat-starters.jpg', subtitle: 'Charred in the tandoor & crisp to order' },
    { id: 'Wood-Fired',    label: 'Wood-Fired & Grills',     image: '/images/hero-table.jpg',   subtitle: 'Live ember flatbreads & smoked skewers' },
    { id: 'Mains',         label: 'Signature Curries',       image: '/images/cat-mains.jpg',    subtitle: 'Slow-simmered gravies & heirloom spices' },
    { id: 'Breads & Rice', label: 'Breads & Rice',           image: '/images/cat-mains.jpg',    subtitle: 'Hand-stretched naans & aged basmati' },
    { id: 'Desserts',      label: 'Desserts',                image: '/images/cat-desserts.jpg', subtitle: 'Warm sweet finishes & saffron infusions' },
    { id: 'Beverages',     label: 'Craft Beverages',         image: '/images/cat-desserts.jpg', subtitle: 'Botanical coolers, chai & cold brews' }
  ];

  const MENU_ITEMS = [
    // Starters
    {
      id: 'st-1',
      name: 'Charred Paneer Tikka',
      category: 'Starters',
      price: 340,
      veg: true,
      spicy: 1,
      bestseller: true,
      prepMins: 12,
      description: 'Artisanal cottage cheese marinated in Kashmiri chili, hung curd, and roasted cumin, served with charred mint chutney.'
    },
    {
      id: 'st-2',
      name: 'Smoked Malabar Pepper Chicken',
      category: 'Starters',
      price: 390,
      veg: false,
      spicy: 2,
      bestseller: true,
      prepMins: 14,
      description: 'Free-range chicken morsels tossed with Tellicherry black pepper, crisp curry leaves, and caramelized shallots.'
    },
    {
      id: 'st-3',
      name: 'Crispy Lotus Stem Honey Chili',
      category: 'Starters',
      price: 320,
      veg: true,
      spicy: 1,
      bestseller: false,
      prepMins: 10,
      description: 'Thinly sliced crisp lotus root glazed with wild forest honey, toasted sesame, and crushed red chilies.'
    },
    {
      id: 'st-4',
      name: 'Avocado & Roasted Corn Chaat',
      category: 'Starters',
      price: 310,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 8,
      description: 'Fire-roasted sweet corn, ripe avocado, pomegranate jewels, tamarind glaze, and crisp sev.'
    },

    // Wood-Fired
    {
      id: 'wf-1',
      name: 'Truffle Wild Mushroom Flatbread',
      category: 'Wood-Fired',
      price: 490,
      veg: true,
      spicy: 0,
      bestseller: true,
      prepMins: 15,
      description: 'Sourdough blistered flatbread topped with roasted shiitake, smoked mozzarella, thyme, and white truffle oil.'
    },
    {
      id: 'wf-2',
      name: 'Tandoori King Prawns',
      category: 'Wood-Fired',
      price: 640,
      veg: false,
      spicy: 2,
      bestseller: true,
      prepMins: 16,
      description: 'Jumbo coastal prawns marinated in ajwain, garlic confit, and saffron butter, finished over live charcoal.'
    },
    {
      id: 'wf-3',
      name: 'Burrata & Smoked Tomato Flatbread',
      category: 'Wood-Fired',
      price: 460,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 14,
      description: 'Wood-fired crust layered with blistered heirloom tomatoes, creamy burrata, basil oil, and flaky sea salt.'
    },
    {
      id: 'wf-4',
      name: 'Ember-Roasted Lamb Seekh',
      category: 'Wood-Fired',
      price: 520,
      veg: false,
      spicy: 2,
      bestseller: false,
      prepMins: 16,
      description: 'Hand-minced spiced lamb skewers grilled over oak charcoal with pickled red onions and green chili relish.'
    },

    // Mains
    {
      id: 'mn-1',
      name: 'Saffron Butter Chicken',
      category: 'Mains',
      price: 520,
      veg: false,
      spicy: 1,
      bestseller: true,
      prepMins: 18,
      description: 'Charcoal-grilled chicken simmered in a velvety heirloom tomato, fenugreek, and Kashmiri saffron butter sauce.'
    },
    {
      id: 'mn-2',
      name: '24-Hour Smoked Dal Makhani',
      category: 'Mains',
      price: 420,
      veg: true,
      spicy: 0,
      bestseller: true,
      prepMins: 12,
      description: 'Whole black urad lentils slow-cooked overnight over dying embers with white butter and roasted garlic.'
    },
    {
      id: 'mn-3',
      name: 'Paneer Lababdar Royale',
      category: 'Mains',
      price: 450,
      veg: true,
      spicy: 1,
      bestseller: false,
      prepMins: 15,
      description: 'Soft paneer medallions folded into a rich cashew-tomato reduction accented with cardamom and charred bell peppers.'
    },
    {
      id: 'mn-4',
      name: 'Coastal Coconut Prawn Curry',
      category: 'Mains',
      price: 590,
      veg: false,
      spicy: 2,
      bestseller: false,
      prepMins: 18,
      description: 'Fresh tiger prawns poached in first-press coconut milk, kokum, roasted shallots, and tempered mustard seeds.'
    },
    {
      id: 'mn-5',
      name: 'Awadhi Subz Dum Biryani',
      category: 'Mains',
      price: 440,
      veg: true,
      spicy: 1,
      bestseller: false,
      prepMins: 20,
      description: 'Aged long-grain basmati layered with seasonal vegetables, saffron milk, rose water, and caramelized onions; served with burhani raita.'
    },

    // Breads & Rice
    {
      id: 'br-1',
      name: 'Blistered Garlic Naan',
      category: 'Breads & Rice',
      price: 110,
      veg: true,
      spicy: 0,
      bestseller: true,
      prepMins: 6,
      description: 'Hand-stretched tandoor naan brushed with roasted garlic cultured butter and fresh coriander.'
    },
    {
      id: 'br-2',
      name: 'Flaky Truffle Malabar Parotta',
      category: 'Breads & Rice',
      price: 140,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 8,
      description: 'Crisp multi-layered southern flatbread finished with a whisper of black truffle butter.'
    },
    {
      id: 'br-3',
      name: 'Saffron Jeera Pulao',
      category: 'Breads & Rice',
      price: 220,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 10,
      description: 'Steamed aged basmati infused with toasted cumin seeds, bay leaf, and saffron threads.'
    },

    // Desserts
    {
      id: 'ds-1',
      name: 'Warm Pistachio Gulab Jamun',
      category: 'Desserts',
      price: 260,
      veg: true,
      spicy: 0,
      bestseller: true,
      prepMins: 8,
      description: 'Golden khoya dumplings steeped in cardamom rose syrup, crowned with roasted Iranian pistachios.'
    },
    {
      id: 'ds-2',
      name: 'Saffron & Cardamom Panna Cotta',
      category: 'Desserts',
      price: 290,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 6,
      description: 'Silky saffron-steeped cream topped with Alphonso mango coulis and dried rose petals.'
    },
    {
      id: 'ds-3',
      name: 'Dark Chocolate Espresso Tart',
      category: 'Desserts',
      price: 310,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 6,
      description: '70% single-origin dark chocolate ganache in a toasted hazelnut crust with flaky sea salt.'
    },

    // Beverages
    {
      id: 'dr-1',
      name: 'Kokum & Rose Cooler',
      category: 'Beverages',
      price: 180,
      veg: true,
      spicy: 0,
      bestseller: true,
      prepMins: 5,
      description: 'Tangy Konkan kokum extract shaken with organic rose water, lime, and sparkling soda.'
    },
    {
      id: 'dr-2',
      name: 'Smoked Tamarind Ginger Fizz',
      category: 'Beverages',
      price: 195,
      veg: true,
      spicy: 1,
      bestseller: false,
      prepMins: 5,
      description: 'House-brewed ginger beer layered with roasted tamarind reduction and chili-salt rim.'
    },
    {
      id: 'dr-3',
      name: 'Artisanal Masala Chai',
      category: 'Beverages',
      price: 130,
      veg: true,
      spicy: 0,
      bestseller: false,
      prepMins: 6,
      description: 'Assam CTC slow-brewed with crushed green cardamom, fresh ginger root, and cinnamon.'
    }
  ];

  function formatMoney(amount) {
    const n = Number(amount || 0);
    return `${CURRENCY}${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  global.MENU_DATA = {
    CURRENCY,
    CATEGORIES,
    MENU_ITEMS,
    formatMoney
  };
})(window);
