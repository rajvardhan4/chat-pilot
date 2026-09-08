<?php
/**
 * Plugin Name:       Chat Pilot
 * Plugin URI:        https://localmarketinggeeks.com/chat-pilot
 * Description:       A premium AI chatbot plugin for WordPress, building a robust, extensible foundation.
 * Version:           1.1.7
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Local Marketing Geeks
 * Author URI:        https://localmarketinggeeks.com/
 * License:           Proprietary
 * Text Domain:       chat-pilot
 */

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Define core constants.
define( 'CHAT_PILOT_VERSION', '1.1.7' );
define( 'CHAT_PILOT_PATH', plugin_dir_path( __FILE__ ) );
define( 'CHAT_PILOT_URL', plugin_dir_url( __FILE__ ) );
define( 'CHAT_PILOT_BASENAME', plugin_basename( __FILE__ ) );

// Load Autoloader.
require_once CHAT_PILOT_PATH . 'includes/Autoloader.php';

// Register autoloader.
\ChatPilot\Autoloader::register();

// Register plugin lifecycle hooks.
register_activation_hook( __FILE__, array( '\ChatPilot\Core\Lifecycle', 'activate' ) );
register_deactivation_hook( __FILE__, array( '\ChatPilot\Core\Lifecycle', 'deactivate' ) );

// Boot the main plugin container.
add_action( 'plugins_loaded', function() {
	\ChatPilot\Core\Plugin::instance();
} );
