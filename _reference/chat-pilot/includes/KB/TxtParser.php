<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class TxtParser
 * Extraction driver for raw plain text documents.
 */
class TxtParser extends BaseParser {

	/**
	 * Extracts and parses plain text from file config.
	 *
	 * @param array $config Source configuration array. Requires 'file_path'.
	 * @return array Parsed documents list.
	 */
	public function parse( array $config ) {
		if ( empty( $config['file_path'] ) || ! file_exists( $config['file_path'] ) ) {
			return array();
		}

		$content = file_get_contents( $config['file_path'] );
		if ( false === $content ) {
			return array();
		}

		// Detect and convert encoding to UTF-8 if necessary.
		$encoding = mb_detect_encoding( $content, array( 'UTF-8', 'ASCII', 'ISO-8859-1' ), true );
		if ( $encoding && 'UTF-8' !== $encoding ) {
			$content = mb_convert_encoding( $content, 'UTF-8', $encoding );
		}

		$clean_content = $this->clean_text( $content );
		$word_count    = $this->count_words( $clean_content );
		$title         = isset( $config['original_name'] ) ? sanitize_file_name( $config['original_name'] ) : basename( $config['file_path'] );

		return array(
			array(
				'title'      => $title,
				'content'    => $clean_content,
				'source_url' => $config['file_path'],
				'metadata'   => array(
					'word_count' => $word_count,
					'file_size'  => filesize( $config['file_path'] ),
				),
			),
		);
	}
}
