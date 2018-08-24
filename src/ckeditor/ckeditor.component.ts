/**
 * @license Copyright (c) 2003-2018, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import {
	Component,
	Input,
	Output,
	NgZone,
	EventEmitter,
	forwardRef,
	AfterViewInit, OnDestroy,
	ElementRef,
	Optional,
	Self,
	HostBinding
} from '@angular/core';

import {
	ControlValueAccessor,
	NG_VALUE_ACCESSOR,
	NgControl
} from '@angular/forms';

import { CKEditor5 } from './ckeditor';
import { MatFormFieldControl } from '@angular/material';
import { Subject } from 'rxjs';

type CKEditorData = string;

let componentId = 0;

@Component( {
	selector: 'ckeditor',
	template: '<ng-template></ng-template>',

	// Integration with @angular/forms.
	// providers: [
	// 	{
	// 		provide: NG_VALUE_ACCESSOR,
	// 		useExisting: forwardRef( () => CKEditorComponent ),
	// 		multi: true,
	// 	}
	// ]
	providers: [ { provide: MatFormFieldControl, useExisting: CKEditorComponent } ],
} )
export class CKEditorComponent implements AfterViewInit, OnDestroy, ControlValueAccessor, MatFormFieldControl<CKEditorData> {
	/**
	 * The reference to the DOM element created by the component.
	 */
	private elementRef!: ElementRef<HTMLElement>;

	/**
	 * The constructor of the editor to be used for the instance of the component.
	 * It can be e.g. the `ClassicEditorBuild`, `InlineEditorBuild` or some custom editor.
	 */
	@Input() editor?: CKEditor5.EditorConstructor;

	/**
	 * The configuration of the editor.
	 * See https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editorconfig-EditorConfig.html
	 * to learn more.
	 */
	@Input() config?: CKEditor5.Config;

	/**
	 * The initial data of the editor. Useful when not using the ngModel.
	 * See https://angular.io/api/forms/NgModel to learn more.
	 */
	@Input() data = '';

	/**
	 * Tag name of the editor component.
	 *
	 * The default tag is 'div'.
	 */
	@Input() tagName = 'div';

	/**
	 * When set `true`, the editor becomes read-only.
	 * See https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editor-Editor.html#member-isReadOnly
	 * to learn more.
	 */
	@Input() set disabled( isDisabled: boolean ) {
		this.setDisabledState( isDisabled );
	}

	get disabled() {
		if ( this.editorInstance ) {
			return this.editorInstance.isReadOnly;
		}

		return this.initialIsDisabled;
	}

	/**
	 * Fires when the editor is ready. It corresponds with the `editor#ready`
	 * https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editor-Editor.html#event-ready
	 * event.
	 */
	@Output() ready = new EventEmitter<CKEditor5.Editor>();

	/**
	 * Fires when the content of the editor has changed. It corresponds with the `editor.model.document#change`
	 * https://ckeditor.com/docs/ckeditor5/latest/api/module_engine_model_document-Document.html#event-change
	 * event.
	 */
	@Output() change: EventEmitter<ChangeEvent> = new EventEmitter<ChangeEvent>();

	/**
	 * Fires when the editing view of the editor is blurred. It corresponds with the `editor.editing.view.document#blur`
	 * https://ckeditor.com/docs/ckeditor5/latest/api/module_engine_view_document-Document.html#event-event:blur
	 * event.
	 */
	@Output() blur: EventEmitter<BlurEvent> = new EventEmitter<BlurEvent>();

	/**
	 * Fires when the editing view of the editor is focused. It corresponds with the `editor.editing.view.document#focus`
	 * https://ckeditor.com/docs/ckeditor5/latest/api/module_engine_view_document-Document.html#event-event:focus
	 * event.
	 */
	@Output() focus: EventEmitter<FocusEvent> = new EventEmitter<FocusEvent>();

	/**
	 * The instance of the editor created by this component.
	 */
	public editorInstance: CKEditor5.Editor | null = null;

	// Implementing MatFormFieldControl.
	get value() {
		return this.data;
	}

	// Implementing MatFormFieldControl.
	public id = 'ckeditor-' + ( componentId++ );

	// Implementing MatFormFieldControl.
	public stateChanges = new Subject<void>();

	// Implementing MatFormFieldControl.
	public placeholder = '';

	// Implementing MatFormFieldControl.
	public get focused() {
		return this._focused;
	}
	private _focused = false;

	// Implementing MatFormFieldControl.
	public get empty() {
		return !!this.editorInstance && this.editorInstance.getData() === '<p>&nbsp;</p>';
	}

	public shouldLabelFloat = false;

	@Input() public required = false;

	public errorState = false;

	@HostBinding( 'attr.aria-describedby' ) describedBy = '';

	/**
	 * If the component is read–only before the editor instance is created, it remembers that state,
	 * so the editor can become read–only once it is ready.
	 */
	private initialIsDisabled = false;

	/**
	 * An instance of https://angular.io/api/core/NgZone to allow the interaction with the editor
	 * withing the Angular event loop.
	 */
	private ngZone: NgZone;

	/**
	 * A callback executed when the content of the editor changes. Part of the
	 * `ControlValueAccessor` (https://angular.io/api/forms/ControlValueAccessor) interface.
	 *
	 * Note: Unset unless the component uses the `ngModel`.
	 */
	private cvaOnChange?: ( data: string ) => void;

	/**
	 * A callback executed when the editor has been blurred. Part of the
	 * `ControlValueAccessor` (https://angular.io/api/forms/ControlValueAccessor) interface.
	 *
	 * Note: Unset unless the component uses the `ngModel`.
	 */
	private cvaOnTouched?: () => void;

	constructor( elementRef: ElementRef, ngZone: NgZone, @Optional() @Self() public ngControl: NgControl, ) {
		this.ngZone = ngZone;
		this.elementRef = elementRef;

		if ( this.ngControl != null ) { this.ngControl.valueAccessor = this; }
	}

	setDescribedByIds( ids: string[] ) {
		this.describedBy = ids.join( ' ' );
	}

	onContainerClick( event: MouseEvent ) {
		if ( this.editorInstance ) {
			this.editorInstance.editing.view.focus();
			this.stateChanges.next();
		}
	}

	// Implementing the AfterViewInit interface.
	ngAfterViewInit() {
		this.ngZone.runOutsideAngular( () => {
			this.createEditor();
		} );
	}

	// Implementing the OnDestroy interface.
	ngOnDestroy() {
		if ( this.editorInstance ) {
			this.editorInstance.destroy();
			this.editorInstance = null;
		}
	}

	// Implementing the ControlValueAccessor interface (only when binding to ngModel).
	writeValue( value: string ): void {
		// If already initialized
		if ( this.editorInstance ) {
			this.editorInstance.setData( value );
		}
		// If not, wait for it to be ready; store the data.
		else {
			this.data = value;
		}
	}

	// Implementing the ControlValueAccessor interface (only when binding to ngModel).
	registerOnChange( callback: ( data: string ) => void ): void {
		this.cvaOnChange = callback;
	}

	// Implementing the ControlValueAccessor interface (only when binding to ngModel).
	registerOnTouched( callback: () => void ): void {
		this.cvaOnTouched = callback;
	}

	// Implementing the ControlValueAccessor interface (only when binding to ngModel).
	setDisabledState( isDisabled: boolean ): void {
		// If already initialized
		if ( this.editorInstance ) {
			this.editorInstance.isReadOnly = isDisabled;
			this.stateChanges.next();
		}
		// If not, wait for it to be ready; store the state.
		else {
			this.initialIsDisabled = isDisabled;
		}
	}

	/**
	 * Creates the editor instance, sets initial editor data,
	 * then integrates the editor with the Angular component.
	 */
	private createEditor(): Promise<any> {
		const element = document.createElement( this.tagName );

		this.elementRef.nativeElement.appendChild( element );

		return this.editor!.create( element, this.config )
			.then( editor => {
				this.editorInstance = editor;

				editor.setData( this.data );

				if ( this.initialIsDisabled ) {
					editor.isReadOnly = this.initialIsDisabled;
				}

				this.ngZone.run( () => {
					this.ready.emit( editor );
				} );

				this.setUpEditorEvents( editor );
				this.stateChanges.next();
			} )
			.catch( ( err: Error ) => {
				console.error( err.stack );
			} );
	}

	/**
	 * Integrates the editor with the component by attaching related event listeners.
	 */
	private setUpEditorEvents( editor: CKEditor5.Editor ): void {
		const modelDocument = editor.model.document;
		const viewDocument = editor.editing.view.document;

		modelDocument.on( 'change:data', ( evt: CKEditor5.EventInfo<'change:data'> ) => {
			const data = editor.getData();

			this.ngZone.run( () => {
				if ( this.cvaOnChange ) {
					this.cvaOnChange( data );
				}

				this.change.emit( { event: evt, editor } );
				this.stateChanges.next();
			} );
		} );

		viewDocument.on( 'focus', ( evt: CKEditor5.EventInfo<'focus'> ) => {
			this.ngZone.run( () => {
				this._focused = true;
				this.focus.emit( { event: evt, editor } );
				this.stateChanges.next();
			} );
		} );

		viewDocument.on( 'blur', ( evt: CKEditor5.EventInfo<'blur'> ) => {
			this.ngZone.run( () => {
				if ( this.cvaOnTouched ) {
					this.cvaOnTouched();
				}

				this._focused = false;
				this.blur.emit( { event: evt, editor } );
				this.stateChanges.next();
			} );
		} );
	}
}

export interface BlurEvent {
	event: CKEditor5.EventInfo<'blur'>;
	editor: CKEditor5.Editor;
}

export interface FocusEvent {
	event: CKEditor5.EventInfo<'focus'>;
	editor: CKEditor5.Editor;
}

export interface ChangeEvent {
	event: CKEditor5.EventInfo<'change:data'>;
	editor: CKEditor5.Editor;
}
