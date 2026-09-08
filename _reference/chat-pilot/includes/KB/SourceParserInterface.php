<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Interface SourceParserInterface
 * Shared contract for all knowledge source parsing drivers.
 */
interface SourceParserInterface {

	/**
	 * Extracts and parses knowledge content from a source configuration.
	 *
	 * @param array $config Configuration credentials and parameters.
	 * @return array Multi-dimensional array of extracted documents.
	 *               Each document must return 'title', 'content', 'source_url', and 'metadata'.
	 */
	public function parse( array $config );
}
