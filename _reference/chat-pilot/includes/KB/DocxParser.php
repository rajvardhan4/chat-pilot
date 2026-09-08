<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class DocxParser
 * Extraction driver for Microsoft Word XML (.docx) documents.
 */
class DocxParser extends BaseParser {

	/**
	 * Extracts and parses Word DOCX contents.
	 *
	 * @param array $config Source configuration array. Requires 'file_path'.
	 * @return array Parsed documents list.
	 */
	public function parse( array $config ) {
		if ( empty( $config['file_path'] ) || ! file_exists( $config['file_path'] ) ) {
			return array();
		}

		if ( ! class_exists( 'ZipArchive' ) ) {
			return array();
		}

		$zip = new \ZipArchive();
		if ( true !== $zip->open( $config['file_path'] ) ) {
			return array();
		}

		// Read the main document XML contents.
		$xml_entry = 'word/document.xml';
		$xml_index = $zip->locateName( $xml_entry );
		if ( false === $xml_index ) {
			$zip->close();
			return array();
		}

		$xml_content = $zip->getFromIndex( $xml_index );
		$zip->close();

		if ( empty( $xml_content ) ) {
			return array();
		}

		$extracted_text = $this->extract_text_from_xml( $xml_content );
		$clean_content  = $this->clean_text( $extracted_text );
		$word_count     = $this->count_words( $clean_content );
		$title          = isset( $config['original_name'] ) ? sanitize_file_name( $config['original_name'] ) : basename( $config['file_path'] );

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

	/**
	 * Parses DOCX Document XML and extracts clean structured lines.
	 *
	 * @param string $xml_content Raw XML string from document.xml.
	 * @return string Structured plain text.
	 */
	private function extract_text_from_xml( $xml_content ) {
		$dom = new \DOMDocument();
		
		// Load XML safely.
		if ( ! @$dom->loadXML( $xml_content ) ) {
			return '';
		}

		$xpath = new \DOMXPath( $dom );
		$xpath->registerNamespace( 'w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' );

		// Query all paragraph nodes.
		$paragraphs = $xpath->query( '//w:p' );
		$out_lines  = array();

		foreach ( $paragraphs as $paragraph ) {
			// Query text sub-nodes within this specific paragraph.
			$texts  = $xpath->query( './/w:t', $paragraph );
			$p_line = '';
			foreach ( $texts as $text_node ) {
				$p_line .= $text_node->nodeValue;
			}
			if ( ! empty( trim( $p_line ) ) ) {
				$out_lines[] = $p_line;
			}
		}

		return implode( "\n\n", $out_lines );
	}
}
